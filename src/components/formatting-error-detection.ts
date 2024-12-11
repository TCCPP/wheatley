import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { build_description, parse_out } from "../utils/strings.js";
import Code from "./code.js";
import { SelfClearingMap, SelfClearingSet } from "../utils/containers.js";
import * as dismark from "dismark";

const FAILED_CODE_BLOCK_RE = /^(?:"""?|'''?)(.+?)(?:"""?|'''?|$)/s;

type failed_code_block = {
    type: "failed_code_block";
    content: string;
};

class FailedCodeBlockRule extends dismark.Rule {
    override match(remaining: string): dismark.match_result | null {
        return remaining.match(FAILED_CODE_BLOCK_RE);
    }

    override parse(
        match: dismark.match_result,
        parser: dismark.MarkdownParser,
        state: dismark.parser_state,
    ): dismark.parse_result {
        return {
            node: {
                type: "failed_code_block",
                content: match[1],
            } as dismark.markdown_node | failed_code_block as dismark.markdown_node,
            fragment_end: match[0].length,
        };
    }
}

export default class FormattingErrorDetection extends BotComponent {
    messaged = new SelfClearingSet<string>(10 * MINUTE);
    // trigger message -> reply
    replies = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);

    static readonly markdown_parser = new dismark.MarkdownParser([
        new dismark.EscapeRule(),
        new dismark.BoldRule(),
        new dismark.UnderlineRule(),
        new dismark.ItalicsRule(),
        new dismark.StrikethroughRule(),
        new dismark.SpoilerRule(),
        new FailedCodeBlockRule(),
        new dismark.CodeBlockRule(),
        new dismark.InlineCodeRule(),
        new dismark.BlockquoteRule(),
        new dismark.SubtextRule(),
        new dismark.HeaderRule(),
        new dismark.LinkRule(),
        new dismark.ListRule(),
        new dismark.TextRule(),
    ]);

    static has_likely_format_errors(content: string, has_skill_roles_other_than_beginner: boolean) {
        // early return
        if (content.search(/['"`]{2}/) === -1) {
            return false;
        }
        const ast = FormattingErrorDetection.markdown_parser.parse(content);
        const scan_for_likely_mistakes = (node: dismark.markdown_node | failed_code_block): boolean => {
            switch (node.type) {
                case "doc":
                    for (const child of node.content) {
                        if (scan_for_likely_mistakes(child)) {
                            return true;
                        }
                    }
                    return false;
                case "list":
                    for (const child of node.items) {
                        if (scan_for_likely_mistakes(child)) {
                            return true;
                        }
                    }
                    return false;
                case "italics":
                case "bold":
                case "underline":
                case "strikethrough":
                case "spoiler":
                case "header":
                case "subtext":
                case "masked_link":
                case "blockquote":
                    return scan_for_likely_mistakes(node.content);
                case "inline_code":
                    return node.content.includes("\n");
                case "code_block":
                    return has_skill_roles_other_than_beginner && node.language === null;
                case "failed_code_block":
                    return (node.content.match(/[()[\];]/g) ?? []).length >= 5;
                case "plain":
                    return false;
                default:
                    throw new Error(`Unknown ast node ${(node as dismark.markdown_node).type}`);
            }
        };
        return scan_for_likely_mistakes(ast);
    }

    has_likely_format_errors(message: Discord.Message) {
        const has_skill_roles_other_than_beginner = message.member
            ? this.wheatley.has_skill_roles_other_than_beginner(message.member)
            : false;
        return FormattingErrorDetection.has_likely_format_errors(message.content, has_skill_roles_other_than_beginner);
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot || message.channel.isDMBased() || this.messaged.has(message.author.id)) {
            return;
        }
        if (this.has_likely_format_errors(message)) {
            const reply = await message.channel.send({
                content: `<@${message.author.id}>`,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle("It looks like you may have code formatting errors in your message")
                        .addFields(...Code.make_code_formatting_embeds(this.wheatley, message.channel))
                        .setDescription(
                            build_description(
                                "**Note:** Make sure to use __**back-ticks**__ (\\`) and not quotes (')",
                                "**Note:** Make sure to specify a **highlighting language**, e.g. \\`cpp\\`, " +
                                    "after the back-ticks",
                            ),
                        ),
                ],
            });
            this.messaged.insert(message.author.id);
            this.replies.set(message.id, reply);
        }
    }

    async delete_reply(id: string) {
        try {
            await this.replies.get(id)?.delete();
            this.replies.remove(id);
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code == 10008) {
                // response deleted
            } else {
                throw e;
            }
        }
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        if (this.replies.has(new_message.id)) {
            const message = !new_message.partial ? new_message : await new_message.fetch();
            if (!this.has_likely_format_errors(message)) {
                await this.delete_reply(new_message.id);
            }
        }
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (this.replies.has(message.id)) {
            await this.delete_reply(message.id);
        }
    }
}
