import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley, create_error_reply } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { build_description } from "../utils/strings.js";

export default class Code extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("code", EarlyReplyMode.visible)
                .set_description("code formatting help")
                .set_allow_trailing_junk(true)
                .set_handler(this.code.bind(this)),
        );
    }

    static make_code_formatting_embeds(wheatley: Wheatley, channel: Discord.TextBasedChannel): Discord.APIEmbedField[] {
        const is_c = [wheatley.channels.c_help.id, wheatley.channels.c_help_text.id].includes(
            wheatley.top_level_channel(channel),
        );
        return [
            {
                name: "Markup",
                inline: true,
                value: build_description(`\\\`\\\`\\\`${is_c ? "c" : "cpp"}`, `int main() {}`, `\\\`\\\`\\\``),
            },
            {
                name: "Result",
                inline: true,
                value: build_description(`\`\`\`${is_c ? "c" : "cpp"}`, `int main() {}`, `\`\`\``),
            },
        ];
    }

    async code(command: TextBasedCommand) {
        if (!command.is_slash()) {
            // text, check for common monke errors
            const message = command.get_message_object();
            // Check for a user trying to format their own code
            if (message.type === Discord.MessageType.Reply) {
                try {
                    const reply = await this.wheatley.fetch_message_reply(message);
                    if (reply.author.id == message.author.id) {
                        await command.reply(create_error_reply("No... Read the embed."));
                        return;
                    }
                } catch (e) {
                    this.wheatley.ignorable_error(e);
                }
            }
            // Check for a user trying to format a string
            if (message.content.trim() !== "!code") {
                await command.reply(create_error_reply("No... Read the embed."));
                return;
            }
        }
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle("How to Format Code on Discord")
                    .addFields(...Code.make_code_formatting_embeds(this.wheatley, await command.get_channel()))
                    .setFooter({
                        text: "Note: Back-tick (`) not quotes (')",
                    }),
            ],
        });
    }
}
