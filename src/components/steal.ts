import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { url_re } from "./quote.js";
import { CUSTOM_EMOJIREGEX } from "../utils/discord.js";
import { remove } from "../utils/arrays.js";

/**
 * Adds a /ping command.
 */
export default class Steal extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("steal-emojis-url")
                .set_description("Steal emojis from a message")
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.steal_url.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("steal-emojis")
                .set_description("Steal emojis from a message")
                .add_string_option({
                    title: "text",
                    description: "text",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.steal_text.bind(this)),
        );
    }

    async steal(command: TextBasedCommand, text: string) {
        const emoji_names = remove(
            this.wheatley.TCCPP.emojis.cache.map(emoji => emoji.name),
            null,
        );
        const matches = [...text.matchAll(CUSTOM_EMOJIREGEX)];
        if (matches.length == 0) {
            await command.reply({
                content: "No emojis",
            });
            return;
        }
        const emojis = matches.map(match => match.slice(2, 5) as [string, string, string]);
        for (const [animated, original_name, id] of emojis) {
            let name = original_name;
            let i = 0;
            while (emoji_names.includes(name)) {
                name = `${original_name}_${i}`;
                i++;
            }
            await this.wheatley.TCCPP.emojis.create({
                attachment:
                    animated == "a"
                        ? `https://cdn.discordapp.com/emojis/${id}.gif`
                        : `https://cdn.discordapp.com/emojis/${id}.png`,
                name,
            });
        }
        await command.reply({
            content: "Done",
        });
    }

    async steal_url(command: TextBasedCommand, url: string) {
        M.log("Received steal-url command");
        const match = url.trim().match(url_re);
        if (match) {
            const [_, guild_id, channel_id, message_id] = match.slice(1);
            assert(guild_id == this.wheatley.TCCPP.id);
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            assert(channel?.isTextBased());
            const message = await channel.messages.fetch(message_id);
            await this.steal(command, message.content);
        } else {
            await command.reply({
                embeds: [new Discord.EmbedBuilder().setDescription("Error").setColor(colors.red)],
                ephemeral_if_possible: true,
            });
        }
    }

    async steal_text(command: TextBasedCommand, message: string) {
        M.log("Received steal command");
        await this.steal(command, message);
    }
}
