import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import SkillRoles, { SkillLevel } from "./skill-roles.js";
import { build_description, parse_out } from "../../../utils/strings.js";
import Code from "../../../components/code.js";
import { SelfClearingMap, SelfClearingSet } from "../../../utils/containers.js";
import * as dismark from "dismark";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { unwrap } from "../../../utils/misc.js";
import { ButtonInteractionBuilder, BotButton } from "../../../command-abstractions/button.js";

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
    private skill_roles!: SkillRoles;

    messaged = new SelfClearingSet<string>(10 * MINUTE);
    // trigger message -> reply
    replies = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);
    private dismiss_button!: BotButton<[string]>;

    override async setup(commands: CommandSetBuilder) {
        this.skill_roles = unwrap(this.wheatley.components.get("SkillRoles")) as SkillRoles;

        this.dismiss_button = commands.add(
            new ButtonInteractionBuilder("formatting_error_dismiss")
                .add_user_id_metadata()
                .set_handler(this.dismiss_handler.bind(this)),
        );
    }

    async dismiss_handler(interaction: Discord.ButtonInteraction, target_user_id: string) {
        if (interaction.user.id !== target_user_id) {
            await interaction.reply({
                ephemeral: true,
                content: "Only the mentioned user can dismiss this message.",
            });
            return;
        }
        await interaction.message.delete();
        await interaction.reply({
            ephemeral: true,
            content: "Done",
        });
    }

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

    static has_enough_special_characters_to_likely_be_code(content: string) {
        const count = (content.match(/[()[\];{}]/g) ?? []).length;
        return count / content.length >= 0.05 && count >= 6;
    }

    static has_likely_format_errors(content: string) {
        // early return
        if (content.search(/['"`]{2}/) === -1) {
            return false;
        }
        const ast = FormattingErrorDetection.markdown_parser.parse(content);
        let has_properly_formatted_code_blocks = false;
        let has_likely_format_mistakes = false;
        const scan_for_likely_mistakes = (node: dismark.markdown_node | failed_code_block) => {
            switch (node.type) {
                case "doc":
                    node.content.forEach(scan_for_likely_mistakes);
                    break;
                case "list":
                    node.items.forEach(scan_for_likely_mistakes);
                    break;
                case "italics":
                case "bold":
                case "underline":
                case "strikethrough":
                case "spoiler":
                case "header":
                case "subtext":
                case "masked_link":
                case "blockquote":
                    scan_for_likely_mistakes(node.content);
                    break;
                case "inline_code":
                    if (node.content.includes("\n")) {
                        has_likely_format_mistakes = true;
                    }
                    break;
                case "code_block":
                    if (node.language !== null) {
                        has_properly_formatted_code_blocks = true;
                    } else if (this.has_enough_special_characters_to_likely_be_code(node.content)) {
                        has_likely_format_mistakes = true;
                    }
                    break;
                case "failed_code_block":
                    if (this.has_enough_special_characters_to_likely_be_code(node.content)) {
                        has_likely_format_mistakes = true;
                    }
                    break;
                case "plain":
                    break;
                default:
                    throw new Error(`Unknown ast node ${(node as dismark.markdown_node).type}`);
            }
        };
        scan_for_likely_mistakes(ast);
        // working around a ts eslint bug
        return (has_likely_format_mistakes as boolean) && !(has_properly_formatted_code_blocks as boolean);
    }

    has_likely_format_errors(message: Discord.Message) {
        // trust Proficient+ members
        if (message.member && this.skill_roles.find_highest_skill_level(message.member) >= SkillLevel.proficient) {
            return false;
        }
        return FormattingErrorDetection.has_likely_format_errors(message.content);
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot || message.channel.isDMBased() || this.messaged.has(message.author.id)) {
            return;
        }
        if (this.has_likely_format_errors(message)) {
            const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                this.dismiss_button
                    .create_button(message.author.id)
                    .setLabel("Acknowledge")
                    .setStyle(Discord.ButtonStyle.Secondary),
            );
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
                components: [row],
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
