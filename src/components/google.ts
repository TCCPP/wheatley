import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Google extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("google", EarlyReplyMode.none)
                .set_category("References")
                .set_description("google")
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                })
                .set_handler(this.google.bind(this)),
        );
    }

    async google(command: TextBasedCommand, query: string) {
        const params = new URLSearchParams();
        params.set("q", query);
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle(query)
                    .setURL(`https://www.google.com/search?${params.toString()}`)
                    .setColor(0x4285f4)
                    .setAuthor({
                        name: "Google",
                        iconURL: "https://cdn.discordapp.com/emojis/1253878497126912113.webp?size=128&quality=lossless",
                    }),
            ],
        });
    }
}
