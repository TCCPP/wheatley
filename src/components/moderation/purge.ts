import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../utils/debugging-and-logging.js";
import { DAY, HOUR, MINUTE, colors } from "../../common.js";
import { BotComponent } from "../../bot-component.js";
import { CommandSetBuilder } from "../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { duration_regex, parse_duration } from "../moderation/moderation-common.js";
import { pluralize } from "../../utils/strings.js";
import { SelfClearingMap } from "../../utils/containers.js";
import { ascending, unwrap } from "../../utils/misc.js";
import { MessageContextMenuInteractionBuilder } from "../../command-abstractions/context-menu.js";
import { decode_snowflake, discord_timestamp, forge_snowflake, parse_url_or_snowflake } from "../../utils/discord.js";
import { chunks } from "../../utils/arrays.js";

type PurgableChannel = Exclude<Discord.TextBasedChannel, Discord.DMChannel | Discord.PartialDMChannel>;
type PurgableMessages = Discord.Collection<string, Discord.Message> | string[];
type PurgeWork = [PurgableChannel, Iterable<PurgableMessages> | AsyncGenerator<PurgableMessages>];

export type message_database_entry = {
    author: {
        id: string;
    };
    guild: string;
    channel: string;
    id: string;
    timestamp: number;
    deleted?: number;
};

export default class Purge extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    // boolean flag indicates whether to continue, serves as a stop token
    tasks = new SelfClearingMap<string, [boolean, Discord.InteractionResponse | null]>(2 * HOUR, 30 * MINUTE);

    private database = this.wheatley.database.create_proxy<{
        message_database: message_database_entry;
    }>();
    private staff_flag_log: Discord.TextChannel;
    private welcome: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);
        this.welcome = await this.utilities.get_channel(this.wheatley.channels.welcome);
        // purge count
        // purge after
        // purge range
        // purge user

        commands.add(
            new TextBasedCommandBuilder("purge", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Purge messages")
                .add_subcommand(
                    new TextBasedCommandBuilder("count", EarlyReplyMode.visible)
                        .set_description("Purge the most recent N messages")
                        .add_number_option({
                            title: "count",
                            description: "Number of messages to purge",
                            required: true,
                        })
                        .set_handler(this.purge_count.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("after", EarlyReplyMode.visible)
                        .set_description("Purge all messages after snowflake")
                        .add_string_option({
                            title: "url",
                            description: "URL or snowflake of the first message to purge",
                            required: true,
                        })
                        .set_handler(this.purge_after.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("range", EarlyReplyMode.visible)
                        .set_description("Purge all messages between start and end")
                        .add_string_option({
                            title: "start",
                            description: "URL or snowflake of the first message to purge",
                            required: true,
                        })
                        .add_string_option({
                            title: "end",
                            description: "URL or snowflake of the last message to purge",
                            required: true,
                        })
                        .set_handler(this.purge_range.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("user", EarlyReplyMode.visible)
                        .set_description("Purge the all messages from a user over a specific timeframe")
                        .add_user_option({
                            title: "user",
                            description: "User whose messages to purge",
                            required: true,
                        })
                        .add_string_option({
                            title: "timeframe",
                            description: "Timeframe for which to purge messages (less than one day)",
                            regex: duration_regex,
                            required: true,
                        })
                        .add_boolean_option({
                            title: "bypass-limit",
                            description:
                                "Bypass the one day time limit (dangerous: Only use if you know what you're doing)",
                            required: false,
                        })
                        .set_handler(this.purge_user.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("user-in-channel", EarlyReplyMode.visible)
                        .set_description("Purge the all messages from a user over a specific timeframe in one channel")
                        .add_user_option({
                            title: "user",
                            description: "User whose messages to purge",
                            required: true,
                        })
                        .add_string_option({
                            title: "timeframe",
                            description: "Timeframe for which to purge messages",
                            regex: duration_regex,
                            required: true,
                        })
                        .set_handler(this.purge_user_channel.bind(this)),
                ),
        );

        commands.add(
            new MessageContextMenuInteractionBuilder("Purge message")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.purge_message.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("dummymessages", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("dummymessages")
                .add_number_option({
                    title: "count",
                    description: "Count",
                    required: true,
                })
                .set_handler(async (command, count) => {
                    await command.reply("Messaging");
                    for (let i = 0; i < count; i++) {
                        await command.followUp({
                            content: (i + 1).toString(),
                            should_text_reply: false,
                        });
                    }
                }),
        );
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith("abort_purge_")) {
                if (!this.wheatley.is_authorized_mod(interaction.user)) {
                    await interaction.reply({
                        content: "Error: You are not authorized",
                        ephemeral: true,
                    });
                    return;
                }
                const id = interaction.customId.substring("abort_purge_".length);
                if (this.tasks.has(id)) {
                    this.tasks.set(id, [false, null]);
                }
                //await interaction.message.edit({ embeds: interaction.message.embeds });
                //await interaction.deferUpdate();
                const m = await interaction.reply("Aborting...");
                if (this.tasks.has(id)) {
                    // if stuff hasn't been resolved while waiting for that promise
                    this.tasks.set(id, [false, m]);
                } else {
                    await m.delete();
                }
            }
        }
    }

    async purge_core(
        command: TextBasedCommand,
        reply_title: string,
        message_generator_per_channel: Iterable<PurgeWork> | AsyncIterable<PurgeWork>,
        include_last_seen = true,
    ) {
        const id = command.get_command_invocation_snowflake();
        assert(!this.tasks.has(id));
        this.tasks.set(id, [true, null]);
        let last_seen = decode_snowflake(id);
        let handled = 0;
        const make_message = (done: boolean): Discord.BaseMessageOptions & CommandAbstractionReplyOptions => ({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle(reply_title)
                    .setDescription(
                        `Purged ${handled} messages` +
                            (include_last_seen ? ` last seen ${discord_timestamp(last_seen)}` : ""),
                    )
                    .setFooter({
                        text: unwrap(this.tasks.get(id))[0] === false ? "Aborted" : done ? "Finished" : "Working...",
                    }),
            ],
            components: done
                ? []
                : [
                      new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                          new Discord.ButtonBuilder()
                              // a custom id can be up to 100 characters long
                              .setCustomId(`abort_purge_${id}`)
                              .setLabel("Abort")
                              .setStyle(Discord.ButtonStyle.Danger),
                      ),
                  ],
        });
        await command.reply(make_message(false));
        outer: for await (const [channel, message_generator] of message_generator_per_channel) {
            for await (const messages of message_generator) {
                assert(this.tasks.has(id));
                if (unwrap(this.tasks.get(id))[0] === false) {
                    break outer;
                }
                const n_messages = messages instanceof Discord.Collection ? messages.size : messages.length;
                M.debug("Purge got", n_messages, "messages");
                assert(!(channel instanceof Discord.PartialGroupDMChannel));
                await channel.bulkDelete(messages);
                handled += n_messages;
                if (include_last_seen) {
                    assert(messages instanceof Discord.Collection);
                    last_seen = Math.min(...[...messages.values()].map(message => message.createdTimestamp));
                }
                command.edit(make_message(false)).catch(this.wheatley.critical_error.bind(this.wheatley));
            }
        }
        await command.edit(make_message(true));
        if (unwrap(this.tasks.get(id))[1]) {
            // an abort message, delete it
            await unwrap(unwrap(this.tasks.get(id))[1]).delete();
        }
        this.tasks.remove(id);
    }

    async purge_count(command: TextBasedCommand, count: number) {
        if (count <= 0) {
            await command.reply({
                embeds: [new Discord.EmbedBuilder().setColor(colors.red).setDescription(`Invalid count specified`)],
            });
            return;
        }
        const id = command.get_command_invocation_snowflake();
        const channel = await command.get_channel();
        async function* generator(): AsyncGenerator<Discord.Collection<string, Discord.Message>> {
            let last_seen = decode_snowflake(id);
            while (count > 0) {
                const messages = await channel.messages.fetch({
                    limit: Math.min(100, count),
                    cache: false,
                    before: forge_snowflake(last_seen - 1),
                });
                if (messages.size == 0) {
                    break;
                }
                yield messages;
                last_seen = Math.min(...[...messages.values()].map(message => message.createdTimestamp));
                count -= messages.size;
            }
        }
        assert(channel.isTextBased() && !channel.isDMBased());
        await this.purge_core(command, `Purging ${pluralize(count, "message")}`, [[channel, generator()]]);
    }

    async purge_after(command: TextBasedCommand, url: string) {
        await this.purge_range(
            command,
            url,
            forge_snowflake(decode_snowflake(command.get_command_invocation_snowflake()) - 2),
            true, // url should be in the same channel as the command
        );
    }

    // inclusive
    async purge_range(
        command: TextBasedCommand,
        start: string,
        end: string,
        expect_this_channel = false,
        filter = (message: Discord.Message) => true,
    ) {
        const [start_guild, start_channel_id, start_message_id] = parse_url_or_snowflake(start);
        const [end_guild, end_channel_id, end_message_id] = parse_url_or_snowflake(end);
        if (
            (start_guild !== null && end_guild !== null && start_guild !== end_guild) ||
            (start_guild !== null && start_guild !== this.wheatley.guild.id) ||
            (end_guild !== null && end_guild !== this.wheatley.guild.id)
        ) {
            await command.reply("Error: Guild needs to be tccpp", true);
        }
        // sort out channel
        const start_channel = start_channel_id
            ? unwrap(await this.wheatley.client.channels.fetch(start_channel_id))
            : await command.get_channel();
        const end_channel = end_channel_id
            ? unwrap(await this.wheatley.client.channels.fetch(end_channel_id))
            : await command.get_channel();
        if (start_channel.id !== end_channel.id) {
            await command.reply("Error: Start and end refer to different channels", true);
            return;
        }
        if (!(start_channel.isTextBased() && !start_channel.isDMBased())) {
            await command.reply("Error: Can't purge in non-text or DM channels", true);
            return;
        }
        const channel = start_channel; // binding must happen after assert so it's typed correctly in the generator
        if (expect_this_channel) {
            assert(channel.id == (await command.get_channel()).id);
        }
        // sort out earliest/last
        const [earliest, latest] = [start_message_id, end_message_id].map(decode_snowflake).sort(ascending);
        async function* generator(): AsyncGenerator<Discord.Collection<string, Discord.Message>> {
            let last_seen = latest + 2; // offset -1 below, and an extra +1 for good measure
            while (true) {
                const messages = (
                    await channel.messages.fetch({
                        limit: 100,
                        cache: false,
                        //after: forge_snowflake(earliest), // apparently this stuff is mutually exclusive
                        before: forge_snowflake(last_seen - 1),
                    })
                ).filter(
                    message => decode_snowflake(message.id) >= earliest && decode_snowflake(message.id) <= last_seen,
                );
                if (messages.size == 0) {
                    break;
                }
                yield messages.filter(filter);
                last_seen = Math.min(...[...messages.values()].map(message => message.createdTimestamp));
            }
        }
        await this.purge_core(command, `Purging range`, [[channel, generator()]]);
    }

    async purge_user(
        command: TextBasedCommand,
        user: Discord.User,
        raw_timeframe: string,
        bypass_limit: boolean | null,
    ) {
        const timeframe = unwrap(parse_duration(raw_timeframe)); // ms
        if (timeframe > DAY && bypass_limit !== true) {
            await command.reply("Max timeframe for user purge is 1 day", true);
            return;
        }
        M.debug("Querying messages");
        const all_messages = await this.database.message_database
            .find({
                "author.id": user.id,
                guild: this.wheatley.guild.id,
                channel: {
                    $nin: [this.staff_flag_log.id, this.welcome.id],
                },
                timestamp: {
                    $gte: Date.now() - timeframe,
                },
                deleted: undefined,
            })
            .toArray();
        M.debug("Finished querying");
        const messages_by_channel = Map.groupBy(all_messages, message => message.channel);
        // await command.edit(`Purging ${all_messages.length} messages across ${messages_by_channel.size} channels`);
        const wheatley = this.wheatley;
        M.debug("Purging", messages_by_channel);
        const messages_by_channel_iter = messages_by_channel.entries();
        async function* generator() {
            while (true) {
                const res = messages_by_channel_iter.next();
                if (res.done) {
                    return;
                }
                const [channel_id, messages] = res.value;
                try {
                    const channel = await wheatley.guild.channels.fetch(channel_id);
                    yield [
                        unwrap(channel),
                        chunks(
                            messages.map(message => message.id),
                            100,
                        ),
                    ] as [PurgableChannel, Generator<string[]>];
                } catch (e) {
                    wheatley.alert(`Failed to fetch channel ${channel_id} ${e}`);
                    // try again
                }
            }
        }
        await this.purge_core(
            command,
            `Purging ${all_messages.length} messages across ${messages_by_channel.size} channels`,
            generator(),
            false,
        );
    }

    async purge_user_channel(command: TextBasedCommand, user: Discord.User, raw_timeframe: string) {
        const timeframe = unwrap(parse_duration(raw_timeframe)); // ms
        const id = command.get_command_invocation_snowflake();
        const end = decode_snowflake(id) - 2;
        const start = end - timeframe;
        await this.purge_range(
            command,
            forge_snowflake(start),
            forge_snowflake(end),
            false,
            (message: Discord.Message) => message.author.id == user.id,
        );
    }

    async purge_message(interaction: Discord.MessageContextMenuCommandInteraction) {
        await interaction.targetMessage.delete();
        await interaction.reply({
            content: "Message deleted",
            ephemeral: true,
        });
    }
}
