import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { CUSTOM_EMOJIREGEX, discord_url_re } from "../utils/discord.js";
import { remove } from "../utils/arrays.js";

export default class Steal extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("steal-emojis-message-url", EarlyReplyMode.visible)
                .set_category("Admin utilities")
                .set_description("Steal emojis from a message")
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.steal_url.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("add-emojis-url", EarlyReplyMode.visible)
                .set_category("Admin utilities")
                .set_description("Add emojis from a message")
                .add_string_option({
                    title: "name",
                    description: "name",
                    required: true,
                })
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.add_url.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("steal-emojis", EarlyReplyMode.visible)
                .set_category("Admin utilities")
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
        const emoji_names = this.wheatley.guild.emojis.cache.map(emoji => emoji.name);
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
            await this.wheatley.guild.emojis.create({
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
        const match = url.trim().match(discord_url_re);
        if (match) {
            const [_, guild_id, channel_id, message_id] = match.slice(1);
            assert(guild_id == this.wheatley.guild.id);
            const channel = await this.wheatley.guild.channels.fetch(channel_id);
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
        await this.steal(command, message);
    }

    async add_url(command: TextBasedCommand, name: string, url: string) {
        assert(url.startsWith("https://") || url.startsWith("http://"));
        await this.wheatley.guild.emojis.create({
            attachment: url,
            name,
        });
        await command.reply({
            content: "Done",
        });
    }
}
