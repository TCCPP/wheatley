import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { escape_discord } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley, create_basic_embed } from "../wheatley.js";
import { colors } from "../common.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { discord_url_re, send_long_response } from "../utils/discord.js";

// These looks silly, but it is the best way I can think of to call all the getters and re-package
function repackage_attachment({
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
}: Discord.Attachment) {
    return {
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
    };
}
function repackage_embed({
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
}: Discord.Embed) {
    return {
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
    };
}

export default class Inspect extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(new MessageContextMenuInteractionBuilder("Inspect").set_handler(this.inspect.bind(this)));

        // Permissions on this command in the interest of preventing spam (intentional or otherwise)
        commands.add(
            new TextBasedCommandBuilder("inspect", "Utility", EarlyReplyMode.ephemeral)
                .set_description("Inspect a message")
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.inspect_text.bind(this)),
        );
    }

    async send_inspected_data(
        message: Discord.Message,
        command_object: Discord.MessageContextMenuCommandInteraction | TextBasedCommand,
    ) {
        if (message.type == Discord.MessageType.Reply) {
            await command_object.reply({
                embeds: [
                    create_basic_embed(
                        undefined,
                        colors.default,
                        `Reply to message id: \`${message.reference?.messageId}\`\n`,
                    ),
                ],
                ephemeral: true,
                ephemeral_if_possible: true,
            });
        }
        await send_long_response(
            command_object,
            message.content.length > 0 ? escape_discord(message.content) : "<empty>",
            true,
            Discord.MessageFlags.SuppressEmbeds,
        );
        if (message.attachments.size > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content: "Attachments:",
                files: [
                    new Discord.AttachmentBuilder(
                        Buffer.from(JSON.stringify(message.attachments.map(repackage_attachment), null, 4)),
                        {
                            name: "attachments.txt",
                        },
                    ),
                ],
            });
        }
        if (message.embeds.length > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content: "Embeds:",
                files: [
                    new Discord.AttachmentBuilder(
                        Buffer.from(JSON.stringify(message.embeds.map(repackage_embed), null, 4)),
                        {
                            name: "embeds.txt",
                        },
                    ),
                ],
            });
        }
        if (message.stickers.size > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content: "Stickers:",
                files: [
                    new Discord.AttachmentBuilder(Buffer.from(JSON.stringify(message.stickers, null, 4)), {
                        name: "stickers.txt",
                    }),
                ],
            });
        }
    }

    async inspect(interaction: Discord.MessageContextMenuCommandInteraction) {
        M.log("Received inspect command");
        await this.send_inspected_data(interaction.targetMessage, interaction);
    }

    async inspect_text(command: TextBasedCommand, url: string) {
        const match = url.trim().match(discord_url_re);
        if (match) {
            const [_, guild_id, channel_id, message_id] = match.slice(1);
            assert(guild_id == this.wheatley.guild.id);
            const channel = await this.wheatley.guild.channels.fetch(channel_id);
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
