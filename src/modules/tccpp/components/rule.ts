import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { colors } from "../../../common.js";


const RULES: readonly string[] = [
    "Treat your peers with respect. Be kind. There are no stupid questions.",
    "Use common sense. We do not tolerate slurs, bigotry of any kind " +
        "(racism/sexism/homophobia/transphobia etc.), or glorification of violence or death.",
    "Don't randomly ping / DM users. Just post your question in one of the help channels.",
    "No advertising other Discord servers.",
    "Keep the content SFW (safe-for-work). This isn't the place for controversial or sensitive topics, " +
        "including politics, ethics, and current affairs, or for discussing your mental health problems.",
    "We're happy to help you learn, however, we do not condone academic dishonesty. " +
        "We will not take your tests for you or write programs for you. " +
        "Likewise avoid giving full solutions to problems when helping other members.",
    "Do not ask for help with unethical cheating/hacking/malware.",
    "Don't post AI-generated answers, and don't ask for help with AI-generated code.",
];

export default class RuleLookup extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("rule", EarlyReplyMode.none)
                .set_category("References")
                .set_description("Look up a server rule by number")
                .add_number_option({
                    title: "number",
                    description: "Rule number (0-7)",
                    required: true,
                })
                .set_handler(this.rule.bind(this)),
        );
    }

    async rule(command: TextBasedCommand, number: number) {
        if (!Number.isInteger(number) || number < 0 || number >= RULES.length) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription(
                            `Invalid rule number. Please pick an integer between 0 and ${RULES.length - 1}.`,
                        ),
                ],
                ephemeral_if_possible: true,
            });
            return;
        }

        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle(`Rule ${number}`)
                    .setDescription(RULES[number]),
            ],
        });
    }
}