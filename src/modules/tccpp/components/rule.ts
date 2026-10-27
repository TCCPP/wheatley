import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { colors } from "../../../common.js";
import Wiki, { WikiArticle } from "../../wheatley/components/wiki.js";

const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;
const RULE_LINE = /^(\d+)\.\s+(.+)$/;

function parse_wiki_rules(wiki: Wiki): Map<number, string> {
    const article: WikiArticle|undefined = wiki.articles["rules.md"];
    if (!article) {
        return new Map();
    }

    const rules = new Map<number, string>();
    for (const field of article.fields) {
        if (!field.name.toLowerCase().includes("rules")) {
            continue;
        }
        for (const raw_line of field.value.split("\n")) {
            const line = raw_line.replace(INVISIBLE_CHARS, "").trim();
            const match = line.match(RULE_LINE);
            if (!match) {
                continue;
            }
            const number = parseInt(match[1], 10);
            const text = match[2].trim();
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

    private cached_rules: Map<number, string> = new Map();

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("rule", EarlyReplyMode.none)
                .set_category("References")
                .set_description("Look up a server rule by number")
                .add_number_option({
                    title : "number",
                    description : "Rule number",
                    required : true,
                })
                .set_handler(this.rule.bind(this)),
        );
    }

    override async on_ready() {
        const wiki = this.wheatley.components.get("Wiki") as Wiki | undefined;
        if (!wiki) {
            return;
        }
        this.cached_rules = parse_wiki_rules(wiki);
    }

    async rule(command: TextBasedCommand, number: number) {
        const rules = this.cached_rules;

        if (rules.size === 0) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription("Rules are not available right now."),
                ],
                ephemeral_if_possible : true,
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
