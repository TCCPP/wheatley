import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M, escape_discord } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { url_re } from "./quote.js";
import { colors } from "../common.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

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

        this.add_command(new MessageContextMenuInteractionBuilder("Inspect").set_handler(this.inspect.bind(this)));

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
            content: message.content.length > 0 ? escape_discord(message.content) : "<empty>",
        });
        if (message.attachments.size > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content:
                    "Attachments: " +
                    escape_discord(JSON.stringify(message.attachments.map(repackage_attachment), null, 4)),
            });
        }
        if (message.embeds.length > 0) {
            await command_object.followUp({
                ephemeral: true,
                ephemeral_if_possible: true,
                content: "Embeds: " + escape_discord(JSON.stringify(message.embeds.map(repackage_embed), null, 4)),
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
