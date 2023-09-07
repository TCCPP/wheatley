import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, critical_error } from "../utils/debugging-and-logging.js";
import { HOUR, MINUTE, colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { duration_regex, parse_duration } from "./moderation/moderation-common.js";
import { decode_snowflake, forge_snowflake } from "./snowflake.js";
import { pluralize } from "../utils/strings.js";
import { SelfClearingMap } from "../utils/containers.js";
import { url_re } from "./quote.js";
import { ascending, unwrap } from "../utils/misc.js";

/**
 * Adds a !purge command.
 */
export default class Purge extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    // boolean flag indicates whether to continue, serves as a stop token
    // TODO: Delete "aborting..." message
    tasks = new SelfClearingMap<string, boolean>(2 * HOUR, 30 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        // purge count
        // purge after
        // purge range
        // purge user

        this.add_command(
            new TextBasedCommandBuilder("purge")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Purge messages")
                .add_subcommand(
                    new TextBasedCommandBuilder("count")
                        .set_description("Purge the most recent N messages")
                        .add_number_option({
                            title: "count",
                            description: "Number of messages to purge",
                            required: true,
                        })
                        .set_handler(this.purge_count.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("after")
                        .set_description("Purge all messages after snowflake")
                        .add_string_option({
                            title: "url",
                            description: "URL or snowflake of the first message to purge",
                            required: true,
                        })
                        .set_handler(this.purge_after.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("range")
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
                    new TextBasedCommandBuilder("user")
                        .set_description("Purge the all messages from a user over a specific timeframe")
                        .add_user_option({
                            title: "user",
                            description: "User to purge",
                            required: true,
                        })
                        .add_string_option({
                            title: "timeframe",
                            description: "Timeframe for which to purge messages",
                            regex: duration_regex,
                            required: true,
                        })
                        .set_handler(this.purge_user.bind(this)),
                ),
        );

        this.add_command(
            new TextBasedCommandBuilder("dummymessages")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("dummymessages")
                .add_number_option({
                    title: "count",
                    description: "Count",
                    required: true,
                })
                .set_handler(async (command, count) => {
                    M.log("Received dummymessages command");
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
                    this.tasks.set(id, false);
                }
                //await interaction.message.edit({ embeds: interaction.message.embeds });
                //await interaction.deferUpdate();
                await interaction.reply("Aborting...");
            }
        }
    }

    parse_url_or_snowflake(url: string): [string | null, string] {
        let match = url.trim().match(url_re);
        if (match) {
            const [_, guild_id, channel_id, message_id] = match.slice(1);
            assert(guild_id == this.wheatley.TCCPP.id);
            return [channel_id, message_id];
        }
        match = url.trim().match(/^\d+$/);
        if (match) {
            return [null, match[0]];
        }
        assert(false);
    }

    async purge_core(
        command: TextBasedCommand,
        channel: Discord.BaseGuildTextChannel | Discord.ThreadChannel,
        reply_title: string,
        generator: () => AsyncGenerator<Discord.Collection<string, Discord.Message>>,
    ) {
        const id = command.get_command_invocation_snowflake();
        assert(!this.tasks.has(id));
        this.tasks.set(id, true);
        let last_seen = decode_snowflake(id);
        let handled = 0;
        const make_message = (done: boolean): Discord.BaseMessageOptions & CommandAbstractionReplyOptions => ({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle(reply_title)
                    .setDescription(`Purged ${handled} messages, last seen <t:${Math.round(last_seen / 1000)}:f>`)
                    .setFooter({
                        text: this.tasks.get(id) === false ? "Aborted" : done ? "Finished" : "Working...",
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
        const generator_instance = generator();
        for await (const messages of generator_instance) {
            assert(this.tasks.has(id));
            if (this.tasks.get(id) === false) {
                await generator_instance.return("x");
                continue;
            }
            M.debug("Purge got", messages.size, "messages");
            //M.log(messages.map(message => message.content).join("\n"));
            //await channel.bulkDelete(messages);
            handled += messages.size;
            last_seen = Math.min(...[...messages.values()].map(message => message.createdTimestamp));
            command.edit(make_message(false)).catch(critical_error);
        }
        await command.edit(make_message(true));
        this.tasks.remove(id);
    }

    async purge_count(command: TextBasedCommand, count: number) {
        M.log("Received purge count command");
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
        assert(channel instanceof Discord.BaseGuildTextChannel || channel instanceof Discord.ThreadChannel);
        await this.purge_core(command, channel, `Purging ${pluralize(count, "message")}`, generator);
    }

    async purge_after(command: TextBasedCommand, url: string) {
        M.log("Received purge after command");
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
        M.log("Received purge range command");
        const [start_channel_id, start_message_id] = this.parse_url_or_snowflake(start);
        const [end_channel_id, end_message_id] = this.parse_url_or_snowflake(end);
        // sort out channel
        const start_channel = start_channel_id
            ? unwrap(await this.wheatley.client.channels.fetch(start_channel_id))
            : await command.get_channel();
        const end_channel = end_channel_id
            ? unwrap(await this.wheatley.client.channels.fetch(end_channel_id))
            : await command.get_channel();
        assert(start_channel.id == end_channel.id);
        assert(start_channel instanceof Discord.BaseGuildTextChannel || start_channel instanceof Discord.ThreadChannel);
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
                //for (const message of messages.values()) {
                //    M.log(
                //        message.id,
                //        decode_snowflake(message.id) >= earliest && decode_snowflake(message.id) <= last_seen,
                //    );
                //}
                yield messages.filter(filter);
                last_seen = Math.min(...[...messages.values()].map(message => message.createdTimestamp));
            }
        }
        await this.purge_core(command, channel, `Purging range`, generator);
    }

    async purge_user(command: TextBasedCommand, user: Discord.User, raw_timeframe: string) {
        M.log("Received purge user command");
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
}
