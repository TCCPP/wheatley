import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, critical_error } from "../utils/debugging-and-logging.js";
import { HOUR, MINUTE, colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { duration_regex } from "./moderation/moderation-common.js";
import { decode_snowflake, forge_snowflake } from "./snowflake.js";
import { pluralize } from "../utils/strings.js";
import { SelfClearingMap } from "../utils/containers.js";

/**
 * Adds a !purge command.
 */
export default class Purge extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    // boolean flag indicates whether to continue, serves as a stop token
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
                        .add_number_option({
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

    override async on_interaction_create(interaction: Discord.Interaction<Discord.CacheType>) {
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
            await channel.bulkDelete(messages);
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
                    cache: true,
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
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle("pong")],
        });
    }

    async purge_range(command: TextBasedCommand, start: string, end: string) {
        M.log("Received purge range command");
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle("pong")],
        });
    }

    async purge_user(command: TextBasedCommand, user: Discord.User) {
        M.log("Received purge user command");
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle("pong")],
        });
    }
}
