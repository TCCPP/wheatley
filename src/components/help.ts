import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { unwrap } from "../utils/misc.js";
import { build_description } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import Wiki from "./wiki.js";

/**
 * !help
 */
export default class Help extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("help").set_description("Bot help and info").set_handler(this.help.bind(this)),
        );
    }

    async help(command: TextBasedCommand) {
        M.log("Received help command");
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle("Wheatley")
            .addFields(
                {
                    name: "Wiki Articles",
                    value: build_description([
                        "`!wiki <article name>` - Pull up an article",
                        "Article shortcuts: " +
                            (unwrap(this.wheatley.components.get("Wiki")) as Wiki).article_aliases
                                .map((_, alias) => `\`${alias}\``)
                                .join(", "),
                    ]),
                },
                {
                    name: "References",
                    value: build_description([
                        "`!cref <query>` Lookup a cppreference c article",
                        "`!cppref <query>` Lookup a cppreference article",
                        "`!man <query>` Lookup a man7 entry",
                    ]),
                },
                {
                    name: "Thread Control",
                    value: build_description(["`!solved` `!unsolved`", "`!archive`", "`!rename <name>`"]),
                },
                {
                    name: "Utility",
                    value: build_description([
                        "`!snowflake <input>`",
                        "`!inspect <message url>`",
                        "`!quote <url>` - Quote a message",
                        "`!quoteb <url>` - Quote a block of messages by the same person",
                        "`!nodistractions <duration>`",
                        "`!removenodistractions`",
                    ]),
                },
                {
                    name: "Misc",
                    value: build_description(["`!ping`", "`!echo <input>`"]),
                },
            );
        if (this.wheatley.is_authorized_mod(command.user)) {
            embed.addFields({
                name: "Moderation",
                value: build_description([
                    "`!ban <user> [duration] [reason]`",
                    "`!unban <user> <reason>`",
                    "`!kick <user> [reason]`",
                    "`!mute <user> [duration] [reason]`",
                    "`!unmute <user> <reason>`",
                    "`!rolepersist add <user> <role> [duration] [reason]`",
                    "`!rolepersist remove <user> <role> <reason>`",
                    "Rolepersist aliases: `noofftopic`, `nosuggestions`, `nosuggestionsatall`, `noreactions`, " +
                        "`nothreads`, `noseriousofftopic`, `notil`, `nomemes`. " +
                        "Syntax: `!(alias) <user> [duration] [reason].`",
                    "`!timeout add <user> [duration] [reason]`",
                    "`!timeout remove <user> <reason>`",
                    "`!warn <user> <reason>`",
                    "`!reason <case> <reason>`",
                    "`!duration <case> <duration>`",
                    "`!expunge <case> <reason>`",
                    "`!modlogs <user>`",
                    "`!case <case>`",
                    "`!redirect <channel>`",
                    'Durations: "perm" for permanent or `number unit` (whitespace ignored).' +
                        " Units are y, M, w, d, h, m, s.",
                ]),
            });
        }
        await command.reply({
            embeds: [embed],
        });
    }
}
