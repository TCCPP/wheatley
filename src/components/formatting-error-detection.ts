import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { parse_out } from "../utils/strings.js";
import Code from "./code.js";

export default class FormattingErrorDetection extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    async has_likely_format_errors(message: Discord.Message) {
        const non_code_content = parse_out(message.content);
        const has_wrong_triple_tick =
            non_code_content.includes(`'''`) || non_code_content.includes(`"""`) || non_code_content.includes("```");
        const is_beginner_and_didnt_highlight =
            message.member &&
            !message.content.includes("```c") &&
            !this.wheatley.has_skill_roles_other_than_beginner(message.member);
        return has_wrong_triple_tick || is_beginner_and_didnt_highlight;
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot || message.channel.isDMBased()) {
            return;
        }
        if (await this.has_likely_format_errors(message)) {
            await message.channel.send({
                content: `<@${message.author.id}>`,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle("It looks like you may have code formatting errors in your message")
                        .addFields(...Code.make_code_formatting_embeds(this.wheatley, message.channel))
                        .setDescription("Note: Make sure to use __**back-ticks**__ (`) and not quotes (')"),
                ],
            });
        }
    }
}
