import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { KeyedMutexSet, M, departialize } from "../utils.js";
import { announcements_channel_id, introductions_channel_id, is_authorized_admin, memes_channel_id,
         resources_channel_id, rules_channel_id, server_suggestions_channel_id, starboard_channel_id,
         the_button_channel_id } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { make_quote_embeds } from "./quote.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

type database_schema = {
    negative_emojis: string[];
    delete_emojis: string[];
    starboard: Record<string, string>;
};

const star_threshold = 5;
const memes_star_threshold = 14;
const other_threshold = 7;
const memes_other_threshold = 14;

const auto_delete_threshold = 10;

const excluded_channels = new Set([
    rules_channel_id,
    announcements_channel_id,
    server_suggestions_channel_id,
    resources_channel_id,
    the_button_channel_id,
    introductions_channel_id,
    starboard_channel_id
]);

// https://stackoverflow.com/questions/64053658/get-emojis-from-message-discord-js-v12
// https://www.reddit.com/r/Discord_Bots/comments/gteo6t/discordjs_is_there_a_way_to_detect_emojis_in_a/
const EMOJIREGEX = /((?<!\\)<a?:[^:]+:(\d+)>)|\p{Emoji_Presentation}|\p{Extended_Pictographic}/gmu;

export class Starboard extends BotComponent {
    data: database_schema;
    mutex = new KeyedMutexSet<string>();

    constructor(wheatley: Wheatley) {
        super(wheatley);
        if(!this.wheatley.database.has("starboard")) {
            this.data = {
                negative_emojis: [],
                delete_emojis: [],
                starboard: {}
            };
        } else {
            this.data = this.wheatley.database.get<database_schema>("starboard");
        }
        this.update_database();

        this.add_command(
            new TextBasedCommandBuilder("add-negative-emoji")
                .set_description("Register a negative emoji")
                .add_string_option({
                    title: "emojis",
                    description: "emojis",
                    required: true
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.add_negative_emoji.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("add-delete-emoji")
                .set_description("Register a delete emoji")
                .add_string_option({
                    title: "emojis",
                    description: "emojis",
                    required: true
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.add_delete_emoji.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("list-starboard-config")
                .set_description("List starboard config")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.list_config.bind(this))
        );
    }

    async update_database() {
        this.wheatley.database.set<database_schema>("starboard", this.data);
        await this.wheatley.database.update();
    }

    reactions_string(message: Discord.Message) {
        return [
            ...message.reactions.cache
                .map(reaction => reaction)
                .filter(({ emoji }) => emoji instanceof Discord.GuildEmoji || emoji.id === null)
                .sort((a, b) => b.count - a.count)
                .map(({ emoji, count }) => `${emoji.id ? `<:${emoji.name}:${emoji.id}>` : emoji.name} **${count}**`),
            `<#${message.channel.id}>`
        ].join(" | ");
    }

    meets_threshold(reaction: Discord.MessageReaction) {
        assert(reaction.emoji.name);
        if(!(reaction.emoji instanceof Discord.GuildEmoji || reaction.emoji.id === null)) return false;
        if(reaction.emoji.name == "⭐") {
            if(reaction.message.channel.id == memes_channel_id) {
                return reaction.count >= memes_star_threshold;
            } else {
                return reaction.count >= star_threshold;
            }
        } else if(!this.data.negative_emojis.includes(reaction.emoji.name)) {
            if(reaction.message.channel.id == memes_channel_id) {
                return reaction.count >= memes_other_threshold;
            } else {
                return reaction.count >= other_threshold;
            }
        }
        return false;
    }

    async is_valid_channel(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        return !excluded_channels.has(channel.id) && !(channel instanceof Discord.ForumChannel) && !channel.isDMBased();
    }

    async update_starboard(message: Discord.Message) {
        this.mutex.lock(message.id);
        try {
            const make_embeds = () => make_quote_embeds(
                [message],
                undefined,
                this.wheatley,
                true,
                "\n\n**[Jump to message!]($$)**"
            );
            if(message.id in this.data.starboard) {
                // edit
                const starboard_message = await this.wheatley.starboard_channel.messages.fetch(
                    this.data.starboard[message.id]
                );
                await starboard_message.edit({
                    content: this.reactions_string(message),
                    ...await make_embeds()
                });
            } else {
                // send
                const starboard_message = await this.wheatley.starboard_channel.send({
                    content: this.reactions_string(message),
                    ...await make_embeds()
                });
                this.data.starboard[message.id] = starboard_message.id;
            }
        } finally {
            this.mutex.unlock(message.id);
        }
        await this.update_database();
    }

    async handle_auto_delete(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        M.log(`Auto-deleting ${reaction.message.content} for ${reaction.count} ${reaction.emoji.name} reactions`);
        const message = await departialize(reaction.message);
        await this.wheatley.staff_action_log_channel.send({
            content: `Auto-deleting message from <@${message.author.id}> for `
                +`${reaction.count} ${reaction.emoji.name} reactions`,
            ...await make_quote_embeds(
                [message],
                undefined,
                this.wheatley,
                true
            )
        });
        await reaction.message.delete();
    }

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser
    ) {
        if(!await this.is_valid_channel(reaction.message.channel)) {
            return;
        }
        // Check delete emojis
        if(
            reaction.emoji.name && this.data.delete_emojis.includes(reaction.emoji.name)
            && reaction.count && reaction.count >= auto_delete_threshold
            && reaction.message.channel.id == memes_channel_id // just in #memes, for now
            && !is_authorized_admin((await departialize(reaction.message)).author.id)
        ) {
            await this.handle_auto_delete(reaction);
            return;
        }
        if(reaction.message.id in this.data.starboard) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
        } else if(this.meets_threshold(await departialize(reaction))) {
            // Send
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_reaction_remove(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser
    ) {
        if(!await this.is_valid_channel(reaction.message.channel)) {
            return;
        }
        if(reaction.message.id in this.data.starboard) {
            // Update counts
            await this.update_starboard(await departialize(reaction.message));
        }
    }

    override async on_message_update(
        old_message: Discord.Message<boolean> | Discord.PartialMessage,
        new_message: Discord.Message<boolean> | Discord.PartialMessage
    ) {
        if(!await this.is_valid_channel(new_message.channel)) {
            return;
        }
        assert(old_message.id == new_message.id);
        if(old_message.id in this.data.starboard) {
            // Update content
            await this.update_starboard(await departialize(new_message));
        }
    }

    override async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        if(message.id in this.data.starboard) {
            this.mutex.lock(message.id);
            try {
                await this.wheatley.starboard_channel.messages.delete(this.data.starboard[message.id]);
                delete this.data.starboard[message.id];
            } finally {
                this.mutex.unlock(message.id);
            }
            await this.update_database();
        }
    }

    async add_negative_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if(emojis) {
            const names = emojis.map(emoji => emoji.startsWith("<") ? emoji.split(":")[1] : emoji);
            this.data.negative_emojis.push(...names);
            await command.reply(`Added ${names.join(", ")} to the negative emojis`);
            await this.update_database();
        }
    }

    async add_delete_emoji(command: TextBasedCommand, arg: string) {
        const emojis = arg.match(EMOJIREGEX);
        if(emojis) {
            const names = emojis.map(emoji => emoji.startsWith("<") ? emoji.split(":")[1] : emoji);
            this.data.delete_emojis.push(...names);
            await command.reply(`Added ${names.join(", ")} to the delete emojis`);
            await this.update_database();
        }
    }

    async list_config(command: TextBasedCommand) {
        await command.reply([
            `Negative emojis: ${this.data.negative_emojis.join(", ")}`,
            `Delete emojis: ${this.data.delete_emojis.join(", ")}`
        ].join("\n"));
    }
}
