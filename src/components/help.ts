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

    command_info(...commands: string[]) {
        return commands.map(command => this.wheatley.text_commands[command].get_command_info());
    }

    async help(command: TextBasedCommand) {
        M.log("Received help command");
        const embeds = [
            new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setTitle("Wheatley")
                .setDescription(
                    build_description(
                        "Wheatley discord bot for the Together C & C++ server. The bot is open source, contributions " +
                            "are welcome at https://github.com/TCCPP/wheatley.",
                    ),
                )
                .setThumbnail("https://avatars.githubusercontent.com/u/142943210")
                .addFields(
                    {
                        name: "Wiki Articles",
                        value: build_description(
                            ...this.command_info("wiki", "wiki-preview"),
                            "Article shortcuts: " +
                                (unwrap(this.wheatley.components.get("Wiki")) as Wiki).article_aliases
                                    .map((_, alias) => `\`${alias}\``)
                                    .join(", "),
                            "Article contributions are welcome " +
                                "[here](https://github.com/TCCPP/wheatley/tree/main/wiki_articles)!",
                        ),
                    },
                    {
                        name: "References",
                        value: build_description(...this.command_info("cppref", "cref", "man")),
                    },
                    {
                        name: "Thread Control",
                        value: build_description(...this.command_info("solved", "unsolved", "archive", "rename")),
                    },
                    {
                        name: "Utility",
                        value: build_description(
                            ...this.command_info(
                                "snowflake",
                                "inspect",
                                "quote",
                                "quoteb",
                                "nodistractions",
                                "removenodistractions",
                            ),
                        ),
                    },
                    {
                        name: "Misc",
                        value: build_description(...this.command_info("ping", "echo", "r")),
                    },
                ),
        ];
        if (this.wheatley.is_authorized_mod(command.user)) {
            embeds.push(
                new Discord.EmbedBuilder().setColor(colors.wheatley).addFields(
                    {
                        name: "Moderation",
                        value: build_description(
                            ...this.command_info(
                                "ban",
                                "unban",
                                "kick",
                                "mute",
                                "unmute",
                                "rolepersist",
                                "timeout",
                                "warn",
                                "reason",
                                "duration",
                                "expunge",
                                "modlogs",
                                "case",
                            ),
                            "Rolepersist aliases: `noofftopic`, `nosuggestions`, `nosuggestionsatall`, " +
                                "`noreactions`, `nothreads`, `noseriousofftopic`, `notil`, `nomemes`. " +
                                `Syntax: \`${this.wheatley.text_commands["noofftopic"]
                                    .get_usage()
                                    .replace("noofftopic", "(alias)")}\``,
                            "Durations: `perm` for permanent or `number unit` (whitespace ignored)." +
                                " Units are y, M, w, d, h, m, s.",
                        ),
                    },
                    {
                        name: "Moderation utilities",
                        value: build_description(...this.command_info("redirect", "purge")),
                    },
                ),
            );
        }
        await command.reply({
            embeds,
        });
    }
}
