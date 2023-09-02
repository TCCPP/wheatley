import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M, critical_error, escape_regex, unwrap, wrap, zip } from "../utils.js";
import {
    TextBasedCommandParameterOptions,
    TextBasedCommandOptionType,
    TextBasedCommandBuilder,
} from "./text-based-command-builder.js";
import { TextBasedCommand } from "./text-based-command.js";
import { BaseBotInteraction } from "./interaction-base.js";
import { Wheatley, create_basic_embed } from "../wheatley.js";
import { colors } from "../common.js";

export class BotTextBasedCommand<Args extends unknown[] = []> extends BaseBotInteraction<[TextBasedCommand, ...Args]> {
    public readonly options = new Discord.Collection<
        string,
        TextBasedCommandParameterOptions & { type: TextBasedCommandOptionType }
    >();
    public readonly subcommands: Discord.Collection<string, BotTextBasedCommand<any>> | null = null;

    constructor(
        name: string,
        public readonly description: string | undefined,
        public readonly slash: boolean,
        public readonly permissions: undefined | bigint,
        builder: TextBasedCommandBuilder<Args, true, true> | TextBasedCommandBuilder<Args, true, false, true>,
        protected readonly wheatley: Wheatley,
    ) {
        super(name, builder.handler ?? (async () => critical_error("This shouldn't happen")));
        this.options = builder.options;
        if (builder.type === "top-level") {
            this.subcommands = new Discord.Collection();
            for (const subcommand of builder.subcommands) {
                for (const [sub_name, sub_description, sub_slash] of zip(
                    subcommand.names,
                    subcommand.descriptions,
                    subcommand.slash_config,
                )) {
                    assert(!this.subcommands.has(sub_name));
                    this.subcommands.set(
                        sub_name,
                        new BotTextBasedCommand(
                            sub_name,
                            sub_description,
                            sub_slash,
                            builder.permissions,
                            subcommand,
                            wheatley,
                        ),
                    );
                }
            }
        }
    }

    async parse_text_arguments(command_obj: TextBasedCommand, command_body: string) {
        // TODO: Handle `required` more thoroughly?
        const reply_with_error = async (message: string, surpress_usage = false) => {
            await command_obj.reply({
                embeds: [
                    create_basic_embed(
                        undefined,
                        colors.red,
                        message +
                            (surpress_usage ? "" : "\n\n**Usage:**\n" + command_obj.command_descriptor.get_usage()),
                    ),
                ],
                should_text_reply: true,
            });
        };
        const command_options: unknown[] = [];
        for (const [i, option] of [...this.options.values()].entries()) {
            if (option.type == "string") {
                if (option.regex) {
                    const match = command_body.match(option.regex);
                    if (match) {
                        command_options.push(match[0]);
                        command_body = command_body.slice(match[0].length).trim();
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        await reply_with_error(`Required argument "${option.title}" not found`);
                        return;
                    }
                } else if (i == this.options.size - 1) {
                    if (command_body !== "") {
                        command_options.push(command_body);
                        command_body = "";
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        await reply_with_error(`Required argument "${option.title}" not found`);
                        return;
                    }
                } else {
                    const re = /^\S+/;
                    const match = command_body.match(re);
                    if (match) {
                        command_options.push(match[0]);
                        command_body = command_body.slice(match[0].length).trim();
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        await reply_with_error(`Required argument "${option.title}" not found`);
                        return;
                    }
                }
            } else if (option.type == "number") {
                // TODO: Handle optional number...
                const re = /^\d+/;
                const match = command_body.match(re);
                if (match) {
                    command_options.push(parseInt(match[0]));
                    command_body = command_body.slice(match[0].length).trim();
                } else if (!option.required) {
                    command_options.push(null);
                } else {
                    await reply_with_error(`Required numeric argument "${option.title}" not found`);
                    return;
                }
            } else if (option.type == "user") {
                // TODO: Handle optional user...
                const re = /^(?:<@(\d{10,})>|(\d{10,}))/;
                const match = command_body.match(re);
                if (match) {
                    const userid = match[1] || match[2];
                    try {
                        const user = await this.wheatley.client.users.fetch(userid);
                        command_options.push(user);
                        command_body = command_body.slice(match[0].length).trim();
                    } catch (e) {
                        M.debug(e);
                        await reply_with_error(`Unable to find user`, true);
                        return;
                    }
                } else if (!option.required) {
                    command_options.push(null);
                } else {
                    await reply_with_error(`Required user argument "${option.title}" not found`);
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            } else if (option.type == "role") {
                const re = new RegExp(
                    this.wheatley.TCCPP.roles.cache
                        .map(role => escape_regex(role.name))
                        .filter(name => name !== "@everyone")
                        .join("|"),
                );
                const match = command_body.match(re);
                if (match) {
                    command_options.push(unwrap(this.wheatley.TCCPP.roles.cache.find(role => role.name === match[0])));
                    command_body = command_body.slice(match[0].length).trim();
                } else if (!option.required) {
                    command_options.push(null);
                } else {
                    await reply_with_error(`Required role argument "${option.title}" not found`);
                    return;
                }
            } else {
                assert(false, "unhandled option type");
            }
        }
        if (command_body != "") {
            await reply_with_error(`Unexpected parameters provided`);
            return;
        }
        return command_options as Args;
    }

    get_usage(raw = false): string {
        if (this.subcommands) {
            return this.subcommands
                .map(command => wrap((raw ? "" : "!") + this.name + " " + command.get_usage(true), raw ? "" : "`"))
                .join("\n");
        } else {
            return wrap(
                [
                    (raw ? "" : "!") + this.name,
                    ...this.options.map(option => (option.required ? `<${option.title}>` : `[${option.title}]`)),
                ].join(" "),
                raw ? "" : "`",
            );
        }
    }
}
