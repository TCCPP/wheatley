import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";
import { unwrap } from "../../../utils/misc.js";
import { EMOJIREGEX, departialize } from "../../../utils/discord.js";
import { KeyedMutexSet } from "../../../utils/containers.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors, DAY, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { MessageContextMenuInteractionBuilder } from "../../../command-abstractions/context-menu.js";
import { has_media } from "./autoreact.js";
import { message_database_entry } from "../../wheatley/components/moderation/purge.js";

const star_threshold = 5;
const other_threshold = 5;
const memes_star_threshold = 16;
const memes_other_threshold = 16;

const auto_delete_threshold = 5;
const auto_delete_threshold_no_media = 8;

const max_deletes_in_24h = 12;

const starboard_epoch = new Date("2023-04-01T00:00:00.000Z").getTime();

// how long does a post have to reach the required reaction count
const starboard_window = 7 * DAY;

enum delete_trigger_type {
    delete_this,
    repost,
}

type starboard_state = {
    id: "starboard";
    delete_emojis?: string[];
    ignored_emojis?: string[];
    negative_emojis?: string[];
    repost_emojis?: string[];
};

type starboard_entry = {
    message: string;
    starboard_entry: string;
    deleted?: boolean;
};

type auto_delete_threshold_notifications = {
    message: string;
};

type auto_delete_voter = {
    user_id: string;
    username: string;
};

type auto_delete_detail_entry = {
    message_id: string;
    message_author_id: string;
    message_author_name: string;
    voters: auto_delete_voter[];
    vote_count: number;
    trigger_type: "delete_this" | "repost";
    delete_timestamp: number;
};

export default class Starboard extends BotComponent {
    mutex = new KeyedMutexSet<string>();

    deletes: number[] = [];

    // delete emojis: will trigger deletion if a threshold is reached relative to non-negative emojis
    // ignored emojis: these don't count towards the starboard
    // negative emojis: these don't count against deleted emojis and also don't go to the starboard
    // repost emojis: will trigger deletion if a threshold is reached relative to non-negative emojis

    delete_emojis!: string[];
    ignored_emojis!: string[];
    negative_emojis!: string[];
    repost_emojis!: string[];

    // TODO: use bot utilities to get channel by name here aswell
    excluded_channels!: Set<any>;

    private starboard!: Discord.TextChannel;
    private staff_delet_log!: Discord.TextChannel;

    private database = this.wheatley.database.create_proxy<{
        component_state: starboard_state;
        auto_delete_threshold_notifications: auto_delete_threshold_notifications;
        starboard_entries: starboard_entry;
        auto_delete_details: auto_delete_detail_entry;
        message_database: message_database_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.starboard_entries, { message: 1 }, { unique: true });
        await ensure_index(
            this.wheatley,
            this.database.auto_delete_threshold_notifications,
            { message: 1 },
            { unique: true },
        );
        await ensure_index(this.wheatley, this.database.auto_delete_details, {
            user: 1,
            trigger_type: 1,
            delete_timestamp: -1,
        });

        this.starboard = await this.utilities.get_channel(this.wheatley.channels.starboard);
        this.staff_delet_log = await this.utilities.get_channel(this.wheatley.channels.staff_delet_log);

        commands.add(
            new TextBasedCommandBuilder("starboard-manage", EarlyReplyMode.visible)
                .set_category("Admin utilities")
                .set_description("Manage starboard configuration")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .add_subcommand(
                    new TextBasedCommandBuilder("add-negative-emoji", EarlyReplyMode.visible)
                        .set_description("Register a negative emoji")
                        .add_string_option({
                            title: "emojis",
                            description: "emojis",
                            required: true,
                        })
                        .set_handler(this.add_negative_emoji.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("add-delete-emoji", EarlyReplyMode.visible)
                        .set_description("Register a delete emoji")
                        .add_string_option({
                            title: "emojis",
                            description: "emojis",
                            required: true,
                        })
                        .set_handler(this.add_delete_emoji.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("add-ignored-emoji", EarlyReplyMode.visible)
                        .set_description("Register an ignored emoji")
                        .add_string_option({
                            title: "emojis",
                            description: "emojis",
                            required: true,
                        })
                        .set_handler(this.add_ignored_emoji.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("add-repost-emoji", EarlyReplyMode.visible)
                        .set_description("Register a repost emoji")
                        .add_string_option({
                            title: "emojis",
                            description: "emojis",
                            required: true,
                        })
                        .set_handler(this.add_repost_emoji.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("list-config", EarlyReplyMode.visible)
                        .set_description("List starboard config")
                        .set_handler(this.list_config.bind(this)),
                ),
        );

        commands.add(
            new MessageContextMenuInteractionBuilder("Add to starboard")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.add_to_starboard_context_menu.bind(this)),
        );
    }

    override async on_ready() {
        const state = await this.database.component_state.findOne({ id: "starboard" });
        this.delete_emojis = state?.delete_emojis ?? [];
        this.ignored_emojis = state?.ignored_emojis ?? [];
        this.negative_emojis = state?.negative_emojis ?? [];
        this.repost_emojis = state?.repost_emojis ?? [];

        this.excluded_channels = new Set([
            this.wheatley.channels.rules,
            this.wheatley.channels.announcements,
            this.wheatley.channels.server_suggestions,
            this.wheatley.channels.resources,
            this.wheatley.channels.the_button,
            this.wheatley.channels.introductions,
            this.wheatley.channels.starboard,
            this.wheatley.channels.goals2024,
            this.wheatley.channels.goals2025,
            this.wheatley.channels.goals2026,
            this.wheatley.channels.skill_role_log,
            this.wheatley.channels.polls,
        ]);
    }

    get_delete_threshold(message: Discord.Message) {
        return has_media(message) ? auto_delete_threshold : auto_delete_threshold_no_media;
    }

    reactions_string(message: Discord.Message) {
        return [
            ...message.reactions.cache
                .map(reaction => reaction)
                .filter(({ emoji }) => emoji instanceof Discord.GuildEmoji || emoji.id === null)
                .filter(({ emoji }) => !(emoji.name && this.ignored_emojis.includes(emoji.name)))
                .sort((a, b) => b.count - a.count)
                .map(
                    ({ emoji, count }) =>
                        `${
                            emoji.id ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.name
                        } **${count}**`,
                ),
            `<#${message.channel.id}>`,
        ].join(" | ");
    }

    get_parent_channel_id(channel: Discord.TextBasedChannel): string {
        if (channel.isThread() && channel.parentId) {
            return channel.parentId;
        }
        return channel.id;
    }

    meets_threshold(reaction: Discord.MessageReaction) {
        assert(reaction.emoji.name);
        if (!(reaction.emoji instanceof Discord.GuildEmoji || reaction.emoji.id === null)) {
            return false;
        }
        const parent_channel_id = this.get_parent_channel_id(reaction.message.channel);
        if (reaction.emoji.name == "⭐") {
            // TODO: use bot utilities to get channel by name here aswell
            if (parent_channel_id == this.wheatley.channels.memes.id) {
                return reaction.count >= memes_star_threshold;
            } else {
                return reaction.count >= star_threshold;
            }
        } else if (
            !(this.negative_emojis.includes(reaction.emoji.name) || this.ignored_emojis.includes(reaction.emoji.name))
        ) {
            // TODO: use bot utilities to get channel by name here aswell
            if (parent_channel_id == this.wheatley.channels.memes.id) {
                return reaction.count >= memes_other_threshold;
            } else {
                return reaction.count >= other_threshold;
            }
        }
        return false;
    }

    async is_valid_channel(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        return !this.excluded_channels.has(channel.id) && (await this.wheatley.is_public_channel(channel));
    }

    async update_starboard(message: Discord.Message) {
        await this.mutex.lock(message.id);
        try {
            const make_embeds = () =>
                this.utilities.make_quote_embeds(message, {
                    template: "\n\n**[Jump to message!]($$)**",
                });
            const starboard_entry = await this.database.starboard_entries.findOne({ message: message.id });
            if (starboard_entry) {
                if (starboard_entry.deleted) {
                    return;
                }
                // edit
                let starboard_message;
                try {
                    starboard_message = await this.starboard.messages.fetch(starboard_entry.starboard_entry);
                } catch (e: any) {
                    // unknown message
                    if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
                        await this.database.starboard_entries.updateOne(
                            {
                                message: message.id,
                            },
                            {
                                $set: {
                                    deleted: true,
                                },
                            },
                        );
                        return;
                    } else {
                        throw e;
                    }
                }
                await starboard_message.edit({
                    content: this.reactions_string(message),
                    ...(await make_embeds()),
                });
            } else {
                // send
                try {
                    const starboard_message = await this.starboard.send({
                        content: this.reactions_string(message),
                        ...(await make_embeds()),
                    });
                    await this.database.starboard_entries.insertOne({
                        message: message.id,
                        starboard_entry: starboard_message.id,
                    });
                } catch (e) {
                    this.wheatley.critical_error(e);
                }
            }
        } finally {
            this.mutex.unlock(message.id);
        }
    }

    deletes_in_last_24h() {
        const last_24h = Date.now() - 60 * MINUTE * 24;
        this.deletes = this.deletes.filter(timestamp => timestamp >= last_24h);
        return this.deletes.length;
    }

    async get_user_statistics(user_id: string) {
        const now = Date.now();
        const seven_days_ago = now - 7 * DAY;
        const thirty_days_ago = now - 30 * DAY;
        const recent_message_count = await this.database.message_database.countDocuments({
            "author.id": user_id,
            timestamp: { $gte: seven_days_ago },
        });
        const recent_delete_count = await this.database.auto_delete_details.countDocuments({
            user: user_id,
            delete_timestamp: { $gte: thirty_days_ago },
            trigger_type: "delete_this",
        });
        const total_delete_count = await this.database.auto_delete_details.countDocuments({
            user: user_id,
            trigger_type: "delete_this",
        });
        return { recent_message_count, recent_delete_count, total_delete_count };
    }

    async send_auto_delete_dm(message: Discord.Message, trigger_type: delete_trigger_type): Promise<boolean> {
        try {
            const trigger_emoji =
                trigger_type === delete_trigger_type.delete_this ? "<:delet_this:669598943117836312>" : ":recycle:";
            const channel_context =
                // TODO: use bot utilities to get channel by name here aswell
                message.channel.id === this.wheatley.channels.memes.id
                    ? " in #memes"
                    : message.channel.id === this.wheatley.channels.cursed_code.id
                      ? " in #cursed-code"
                      : "";
            const notification_embed = new Discord.EmbedBuilder()
                .setColor(colors.red)
                .setTitle(`Message Auto-Deleted in ${message.channel.url}`)
                .setDescription(`Triggered by ${trigger_emoji} reactions threshold reached`)
                .setTimestamp();
            const quote_embeds = await this.utilities.make_quote_embeds(message, {
                template: "\n\n**Your deleted message:**",
            });
            const dm_channel = await message.author.createDM();
            await dm_channel.send({
                embeds: [notification_embed, ...quote_embeds.embeds],
                files: quote_embeds.files,
            });
            return true;
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 50007) {
                M.log(`Could not send DM to ${message.author.tag} (DMs disabled)`);
                return false;
            } else {
                throw e;
            }
        }
    }

    async handle_auto_delete(
        message: Discord.Message,
        trigger_reaction: Discord.MessageReaction,
        trigger_type: delete_trigger_type,
    ) {
        const reactions = message.reactions.cache.map(r => [r.emoji, r.count] as [Discord.Emoji, number]);
        const non_negative_reactions = reactions.filter(
            ([emoji, _]) =>
                !this.negative_emojis.includes(unwrap(emoji.name)) &&
                !this.delete_emojis.includes(unwrap(emoji.name)) &&
                !this.repost_emojis.includes(unwrap(emoji.name)),
        );
        const max_non_negative = Math.max(...non_negative_reactions.map(([_, count]) => count)); // -inf if |a|=0
        let do_delete = true;
        if (
            ![this.wheatley.channels.memes, this.wheatley.channels.cursed_code].some(ch => ch.id === message.channel.id)
        ) {
            do_delete = false;
        }
        if (trigger_reaction.count <= max_non_negative) {
            do_delete = false;
        }
        if (
            (await this.wheatley.check_permissions(message.author, Discord.PermissionFlagsBits.Administrator)) ||
            message.author.bot
        ) {
            do_delete = false;
        }
        if (this.deletes_in_last_24h() >= max_deletes_in_24h) {
            do_delete = false;
            this.wheatley.info(">> DELETE IN 24H THRESHOLD EXCEEDED");
        }
        const action = do_delete ? "Auto-deleting" : "Auto-delete threshold reached";
        M.log(`${action} ${message.url} for ${trigger_reaction.count} ${trigger_reaction.emoji.name} reactions`);
        let flag_message: Discord.Message | null = null;
        let dm_sent = false;
        try {
            await this.wheatley.database.lock();
            if (
                do_delete ||
                !(await this.database.auto_delete_threshold_notifications.findOne({ message: message.id }))
            ) {
                const author_stats = await this.get_user_statistics(message.author.id);
                const voters = await trigger_reaction.users.fetch();
                const voter_stats = await Promise.all(
                    voters.map(async user => {
                        const stats = await this.get_user_statistics(user.id);
                        return { user, stats };
                    }),
                );
                const author_stats_value =
                    `Recent activity: \`${author_stats.recent_message_count}\` messages (7d) | ` +
                    `Deletes: \`${author_stats.recent_delete_count}\` (30d), ` +
                    `\`${author_stats.total_delete_count}\` total`;
                const voter_lines = voter_stats
                    .map(
                        ({ user, stats }) =>
                            `<@${user.id}> ${user.tag} | \`${stats.recent_message_count}\` messages (7d) | ` +
                            `Deletes: \`${stats.recent_delete_count}\` (30d), \`${stats.total_delete_count}\` total`,
                    )
                    .join("\n");
                if (do_delete) {
                    dm_sent = await this.send_auto_delete_dm(message, trigger_type);
                }
                const stats_embed = new Discord.EmbedBuilder()
                    .setColor(
                        trigger_type == delete_trigger_type.repost
                            ? colors.green
                            : do_delete
                              ? colors.red
                              : colors.alert_color,
                    )
                    .setTitle(action)
                    .setDescription(
                        `Message from <@${message.author.id}> for ${trigger_reaction.count} ` +
                            `${trigger_reaction.emoji.name} reactions\n` +
                            `${this.reactions_string(message)}`,
                    )
                    .addFields(
                        {
                            name: "Author Statistics",
                            value: author_stats_value,
                            inline: false,
                        },
                        {
                            name: "Voters",
                            value: voter_lines,
                            inline: false,
                        },
                    )
                    .setFooter({ text: `ID: ${message.author.id}` });
                if (do_delete && !dm_sent) {
                    stats_embed.addFields({
                        name: "DM Notification",
                        value: "⚠️ Failed to send DM (user has DMs disabled)",
                        inline: false,
                    });
                }
                const quote_embeds = await this.utilities.make_quote_embeds(message);
                flag_message = await this.staff_delet_log.send({
                    embeds: [stats_embed, ...quote_embeds.embeds],
                    files: quote_embeds.files,
                    allowedMentions: { parse: [] },
                });
                // E11000 duplicate key error collection can happen here if somehow the key is inserted but the delete
                // doesn't happen. The bot restarting might be how this happens. Silently continue.
                await this.database.auto_delete_threshold_notifications.insertOne({
                    message: message.id,
                });
            }
        } catch (e) {
            if (e instanceof mongo.MongoServerError && e.code == 11000) {
                // ok
            } else {
                do_delete = false;
                M.log("--------------->", message.url);
                this.wheatley.critical_error(e);
            }
        } finally {
            this.wheatley.database.unlock();
        }
        if (do_delete) {
            const delete_timestamp = Date.now();
            const voters = await trigger_reaction.users.fetch();
            const voter_list: auto_delete_voter[] = voters.map(user => ({
                user_id: user.id,
                username: user.tag,
            }));
            await this.database.auto_delete_details.insertOne({
                message_id: message.id,
                message_author_id: message.author.id,
                message_author_name: message.author.tag,
                voters: voter_list,
                vote_count: trigger_reaction.count,
                trigger_type: trigger_type === delete_trigger_type.delete_this ? "delete_this" : "repost",
                delete_timestamp,
            });
            await message.delete();
            assert(!(message.channel instanceof Discord.PartialGroupDMChannel));
            if (trigger_type == delete_trigger_type.delete_this) {
                // TODO: use bot utilities to get channel by name here aswell
                if (message.channel.id == this.wheatley.channels.memes.id) {
                    await message.channel.send(
                        `<@${message.author.id}> A message of yours was automatically deleted because a threshold for` +
                            " <:delet_this:669598943117836312> reactions (or similar) was reached.\n\n" +
                            "FAQ: How can I avoid this in the future?\n" +
                            "Answer: Post less cringe",
                    );
                } else {
                    await message.channel.send(
                        `<@${message.author.id}> A message of yours was automatically deleted because a threshold for` +
                            " <:delet_this:669598943117836312> reactions (or similar) was reached.\n" +
                            "This was likely due to your post not actually being cursed code.",
                    );
                }
            } else {
                await message.channel.send(
                    `<@${message.author.id}> A message of yours was automatically deleted because a threshold for` +
                        " :recycle: reactions (or similar) was reached.",
                );
            }
            this.deletes.push(Date.now());
        }
    }

    // Check if the # of reactions is full, and there is no negative emojis reacted yet
    should_delete_reaction(reaction: Discord.MessageReaction) {
        return (
            // TODO: use bot utilities to get channel by name here aswell
            reaction.message.channel.id === this.wheatley.channels.memes.id &&
            reaction.message.reactions.cache.size === 20 &&
            reaction.message.reactions.cache.filter(
                reaction =>
                    reaction.emoji.name &&
                    (this.repost_emojis.includes(reaction.emoji.name) ||
                        this.delete_emojis.includes(reaction.emoji.name) ||
                        this.negative_emojis.includes(reaction.emoji.name)),
            ).size === 0
        );
    }
    override async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        if (reaction.message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (!(await this.is_valid_channel(reaction.message.channel))) {
            return;
        }
        if (reaction.partial) {
            reaction = await reaction.fetch();
        }

        if (this.should_delete_reaction(reaction)) {
            const last_reaction = reaction.message.reactions.cache.last();
            await last_reaction?.remove();
        }
        // Check delete emojis
        const message = await departialize(reaction.message);
        if (
            reaction.emoji.name &&
            this.delete_emojis.includes(reaction.emoji.name) &&
            reaction.count >= this.get_delete_threshold(message)
        ) {
            await this.handle_auto_delete(message, reaction, delete_trigger_type.delete_this);
            return;
        }
        if (
            reaction.emoji.name &&
            this.repost_emojis.includes(reaction.emoji.name) &&
            reaction.count >= this.get_delete_threshold(message)
        ) {
            await this.handle_auto_delete(message, reaction, delete_trigger_type.repost);
            return;
        }

        // Update/add to starboard
        if (await this.database.starboard_entries.findOne({ message: reaction.message.id })) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
            return;
        }
        if (
            this.meets_threshold(await departialize(reaction)) &&
            reaction.message.createdTimestamp >= starboard_epoch &&
            reaction.message.createdTimestamp >= Date.now() - starboard_window
        ) {
            // Send
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        if (reaction.message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (!(await this.is_valid_channel(reaction.message.channel))) {
            return;
        }
        if (await this.database.starboard_entries.findOne({ message: reaction.message.id })) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        if (new_message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (!(await this.is_valid_channel(new_message.channel))) {
            return;
        }
        assert(old_message.id == new_message.id);
        if (await this.database.starboard_entries.findOne({ message: old_message.id })) {
            // Update content
            await this.update_starboard(await departialize(new_message));
        }
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        const entry = await this.database.starboard_entries.findOne({ message: message.id });
        if (entry) {
            await this.mutex.lock(message.id);
            try {
                await this.starboard.messages.delete(entry.starboard_entry);
                await this.database.starboard_entries.deleteOne({ message: message.id });
            } finally {
                this.mutex.unlock(message.id);
            }
        }
    }

    //
    // Starboard config commands
    //

    async add_negative_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if (emojis) {
            const names = emojis.map(emoji => (emoji.startsWith("<") ? emoji.split(":")[1] : emoji));
            const res = await this.database.component_state.findOneAndUpdate(
                { id: "starboard" },
                {
                    $push: {
                        negative_emojis: {
                            $each: names.filter(name => !this.negative_emojis.includes(name)),
                        },
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            this.negative_emojis = unwrap(res).negative_emojis!;
            await command.reply(`Added ${names.join(", ")} to the negative emojis`);
        } else {
            await command.reply("No emojis found");
        }
    }

    async add_delete_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if (emojis) {
            const names = emojis.map(emoji => (emoji.startsWith("<") ? emoji.split(":")[1] : emoji));
            const res = await this.database.component_state.findOneAndUpdate(
                { id: "starboard" },
                {
                    $push: {
                        delete_emojis: {
                            $each: names.filter(name => !this.delete_emojis.includes(name)),
                        },
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            this.delete_emojis = unwrap(res).delete_emojis!;
            await command.reply(`Added ${names.join(", ")} to the delete emojis`);
        } else {
            await command.reply("No emojis found");
        }
    }

    async add_ignored_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if (emojis) {
            const names = emojis.map(emoji => (emoji.startsWith("<") ? emoji.split(":")[1] : emoji));
            const res = await this.database.component_state.findOneAndUpdate(
                { id: "starboard" },
                {
                    $push: {
                        ignored_emojis: {
                            $each: names.filter(name => !this.ignored_emojis.includes(name)),
                        },
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            this.ignored_emojis = unwrap(res).ignored_emojis!;
            await command.reply(`Added ${names.join(", ")} to the ignored emojis`);
        } else {
            await command.reply("No emojis found");
        }
    }

    async add_repost_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if (emojis) {
            const names = emojis.map(emoji => (emoji.startsWith("<") ? emoji.split(":")[1] : emoji));
            const res = await this.database.component_state.findOneAndUpdate(
                { id: "starboard" },
                {
                    $push: {
                        repost_emojis: {
                            $each: names.filter(name => !this.repost_emojis.includes(name)),
                        },
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            this.repost_emojis = unwrap(res).repost_emojis!;
            await command.reply(`Added ${names.join(", ")} to the ignored emojis`);
        } else {
            await command.reply("No emojis found");
        }
    }

    async list_config(command: TextBasedCommand) {
        await command.reply(
            [
                `Negative emojis: ${this.negative_emojis.join(", ")}`,
                `Delete emojis: ${this.delete_emojis.join(", ")}`,
                `Ignored emojis: ${this.ignored_emojis.join(", ")}`,
                `Repost emojis: ${this.repost_emojis.join(", ")}`,
            ].join("\n"),
        );
    }

    async add_to_starboard_context_menu(interaction: Discord.MessageContextMenuCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        const message = interaction.targetMessage;

        if (!(await this.is_valid_channel(message.channel))) {
            await interaction.editReply("Cannot add messages from this channel to the starboard.");
            return;
        }

        const existing_entry = await this.database.starboard_entries.findOne({ message: message.id });
        if (existing_entry) {
            await interaction.editReply("This message is already on the starboard.");
            return;
        }

        await this.update_starboard(message);
        await interaction.editReply("Message added to the starboard.");
    }
}
