import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { colors } from "../../../common.js";
import { unwrap } from "../../../utils/misc.js";
import Wiki from "../../wheatley/components/wiki.js";

const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;
const RULE_LINE = /^(\d+)\.\s+(.+)$/;

function ParseWikiRules(wiki: Wiki): Map<number, string> {
    const article = wiki.articles["rules.md"];

    const rules = new Map<number, string>();
    for (const field of article.fields) {
        if (!field.name.toLowerCase().includes("rules")) {
            continue;
        }
        for (const raw_line of field.value.split("\n")) {
            const line = raw_line.replace(INVISIBLE_CHARS, "").trim();
            const m = line.match(RULE_LINE);
            if (!m) {
                continue;
            }
            const number = parseInt(m[1], 10);
            const text = m[2].trim();
            if (text) {
                rules.set(number, text);
            }
        }
    }
    return rules;
}

export default class RuleLookup extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private cached_rules: Map<number, string> | null = null;

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("rule", EarlyReplyMode.none)
                .set_category("References")
                .set_description("Look up a server rule by number")
                .add_number_option({
                    title: "number",
                    description: "Rule number (0-9)",
                    required: true,
                })
                .set_handler(this.rule.bind(this)),
        );
    }

    async rule(command: TextBasedCommand, number: number) {
        if (this.cached_rules === null) {
            const wiki = unwrap(this.wheatley.components.get("Wiki")) as Wiki;
            this.cached_rules = ParseWikiRules(wiki);
        }
        const rules = this.cached_rules;

        if (rules.size === 0) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription("Rules are not available right now."),
                ],
                ephemeral_if_possible: true,
            });
            return;
        }

        const text = Number.isInteger(number) ? rules.get(number) : undefined;
        if (text === undefined) {
            const keys = [...rules.keys()].sort((a, b) => a - b);
            const min = keys[0];
            const max = keys[keys.length - 1];
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription(`Invalid rule number. Please pick a number between ${min} and ${max}.`),
                ],
                ephemeral_if_possible: true,
            });
            return;
        }

        await command.reply({
            embeds: [
                new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle(`Rule ${number}`).setDescription(text),
            ],
        });
    }
}
