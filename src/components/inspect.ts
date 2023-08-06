import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuCommandBuilder, TextBasedCommand, TextBasedCommandBuilder } from "../command.js";
import { url_re } from "./quote.js";
import { colors } from "../common.js";

/**
 * Adds an /inspect application command for displaying the markdown used to
 * generate a message.
 */
export default class Inspect extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(new MessageContextMenuCommandBuilder("Inspect").set_handler(this.inspect.bind(this)));

        this.add_command(
            new TextBasedCommandBuilder("inspect")
                .set_description("Inspect a message")
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.inspect_text.bind(this)),
        );
    }

    async send_inspected_data(
        message: Discord.Message,
        command_object: Discord.MessageContextMenuCommandInteraction | TextBasedCommand,
    ) {
        await command_object.reply({
            ephemeral: true,
            ephemeral_if_possible: true,
            content:
                message.content.length > 0
                    ? Discord.escapeMarkdown(message.content).replace(/[<>/]/g, c => `\\${c}`)
                    : "<empty>",
        });
        if (message.attachments.size > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content:
                    "Attachments: " +
                    JSON.stringify(
                        message.attachments.map(
                            // This looks silly, but it is the best way I can think of to call all the getters and re-package
                            ({
                                contentType,
                                description,
                                ephemeral,
                                height,
                                id,
                                name,
                                proxyURL,
                                size,
                                spoiler,
                                url,
                                width,
                            }) => ({
                                contentType,
                                description,
                                ephemeral,
                                height,
                                id,
                                name,
                                proxyURL,
                                size,
                                spoiler,
                                url,
                                width,
                            }),
                        ),
                        null,
                        4,
                    ),
            });
        }
        if (message.embeds.length > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content:
                    "Embeds: " +
                    JSON.stringify(
                        message.embeds.map(
                            // This looks silly, but it is the best way I can think of to call all the getters and re-package
                            ({
                                author,
                                color,
                                data,
                                description,
                                fields,
                                footer,
                                hexColor,
                                image,
                                length,
                                provider,
                                thumbnail,
                                timestamp,
                                title,
                                url,
                                video,
                            }) => ({
                                author,
                                color,
                                data,
                                description,
                                fields,
                                footer,
                                hexColor,
                                image,
                                length,
                                provider,
                                thumbnail,
                                timestamp,
                                title,
                                url,
                                video,
                            }),
                        ),
                        null,
                        4,
                    ),
            });
        }
    }

    async inspect(interaction: Discord.MessageContextMenuCommandInteraction) {
        M.log("Received inspect command");
        await this.send_inspected_data(interaction.targetMessage, interaction);
    }

    async inspect_text(command: TextBasedCommand, url: string) {
        M.log("Received inspect text command");
        const match = url.trim().match(url_re);
        if (match) {
            const [_, guild_id, channel_id, message_id] = match.slice(1);
            assert(guild_id == this.wheatley.TCCPP.id);
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            assert(channel?.isTextBased());
            const message = await channel.messages.fetch(message_id);
            await this.send_inspected_data(message, command);
        } else {
            await command.reply({
                embeds: [new Discord.EmbedBuilder().setDescription("Error").setColor(colors.red)],
                ephemeral_if_possible: true,
            });
        }
    }
}
