import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { build_description, parse_out } from "../utils/strings.js";
import Code from "./code.js";
import { SelfClearingMap, SelfClearingSet } from "../utils/containers.js";

export default class FormattingErrorDetection extends BotComponent {
    messaged = new SelfClearingSet<string>(10 * MINUTE);
    // trigger message -> reply
    replies = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);

    async has_likely_format_errors(message: Discord.Message) {
        const non_code_content = parse_out(message.content);
        const has_wrong_triple_tick =
            non_code_content.includes(`'''`) || non_code_content.includes(`"""`) || non_code_content.includes("```");
        const is_beginner_and_didnt_highlight =
            message.member &&
            message.content.includes("```") &&
            !message.content.match(/```\w/gi) &&
            !this.wheatley.has_skill_roles_other_than_beginner(message.member);
        return has_wrong_triple_tick || is_beginner_and_didnt_highlight;
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot || message.channel.isDMBased() || this.messaged.has(message.author.id)) {
            return;
        }
        if (await this.has_likely_format_errors(message)) {
            const reply = await message.channel.send({
                content: `<@${message.author.id}>`,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle("It looks like you may have code formatting errors in your message")
                        .addFields(...Code.make_code_formatting_embeds(this.wheatley, message.channel))
                        .setDescription(
                            build_description(
                                "Note: Make sure to use __**back-ticks**__ (\\`) and not quotes (')",
                                "Note: Make sure to specify a highlighting language, e.g. \\`cpp\\`, " +
                                    "after the back-ticks",
                            ),
                        ),
                ],
            });
            this.messaged.insert(message.author.id);
            this.replies.set(message.id, reply);
        }
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        if (this.replies.has(new_message.id)) {
            const message = !new_message.partial ? new_message : await new_message.fetch();
            if (!(await this.has_likely_format_errors(message))) {
                await this.replies.get(new_message.id)?.delete();
                this.replies.remove(new_message.id);
            }
        }
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (this.replies.has(message.id)) {
            await this.replies.get(message.id)!.delete();
        }
    }
}
