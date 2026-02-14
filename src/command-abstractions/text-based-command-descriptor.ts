import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { build_description, escape_regex, wrap } from "../utils/strings.js";
import { zip } from "../utils/iterables.js";
import { M } from "../utils/debugging-and-logging.js";
import {
    TextBasedCommandParameterOptions,
    TextBasedCommandParameterOptionsWithChoices,
    TextBasedCommandOptionType,
    TextBasedCommandBuilder,
    EarlyReplyMode,
    CommandCategory,
} from "./text-based-command-builder.js";
import { TextBasedCommand } from "./text-based-command.js";
import { BaseBotInteraction } from "./interaction-base.js";
import { Wheatley, create_basic_embed } from "../wheatley.js";
import { colors } from "../common.js";

enum ParseErrorType {
    RequiredArgument,
    InvalidChoice,
}

class ParseError extends Error {
    constructor(
        readonly error_type: ParseErrorType,
        message: string,
    ) {
        super(message);
    }
}

export class BotTextBasedCommand<Args extends unknown[] = []> extends BaseBotInteraction<[TextBasedCommand, ...Args]> {
    public readonly options = new Discord.Collection<
        string,
        TextBasedCommandParameterOptions & { type: TextBasedCommandOptionType }
    >();
    public readonly subcommands: Discord.Collection<string, BotTextBasedCommand<any>> | null = null;
    public readonly display_name: string;
    public readonly all_names: string[];
    public readonly all_display_names: string[];

    constructor(
        name: string,
        public readonly display_prefix: string,
        public readonly description: string,
        public readonly slash: boolean,
        public readonly permissions: undefined | bigint,
        public readonly category: CommandCategory | undefined,
        public readonly alias_of: string | undefined,
        public readonly allow_trailing_junk: boolean,
        public readonly early_reply_mode: EarlyReplyMode,
        builder: TextBasedCommandBuilder<Args, true, true> | TextBasedCommandBuilder<Args, true, false, true>,
        protected readonly wheatley: Wheatley,
    ) {
        super(name, builder.handler ?? (async () => wheatley.critical_error("This shouldn't happen")));
        this.options = builder.options;
        this.display_name = `${display_prefix}${name}`;
        this.all_names = builder.names;
        this.all_display_names = builder.names.map(name => `${display_prefix}${name}`);
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
                            `${display_prefix}${name} `,
                            sub_description,
                            sub_slash,
                            permissions,
                            category,
                            subcommand.alias_of ?? alias_of,
                            allow_trailing_junk,
                            subcommand.early_reply_mode,
                            subcommand,
                            wheatley,
                        ),
                    );
                }
            }
        }
    }

    // Returns a pattern matching whitespace followed by the start of a value of the given type.
    // Used to find where a string option ends and the next option begins.
    private static leading_pattern_for_type(type: TextBasedCommandOptionType): RegExp | null {
        switch (type) {
            case "user":
            case "users":
                return /\s(?:<@\d{10,}>|\d{10,})/;
            case "number":
                return /\s\d/;
            case "boolean":
                return /\s(?:true|false)\b/i;
            default:
                return null;
        }
    }

    to_slash_command<B extends Discord.SlashCommandBuilder | Discord.SlashCommandSubcommandBuilder>(djs_builder: B): B {
        assert(this.slash);
        if (this.subcommands) {
            const slash_command = new Discord.SlashCommandBuilder().setName(this.name).setDescription(this.description);
            for (const subcommand of this.subcommands.values()) {
                slash_command.addSubcommand(subcommand_builder => subcommand.to_slash_command(subcommand_builder));
            }
            if (this.permissions !== undefined) {
                slash_command.setDefaultMemberPermissions(this.permissions);
            }
            return <B>slash_command;
        } else {
            const djs_command = djs_builder.setName(this.name).setDescription(this.description);
            for (const option of this.options.values()) {
                // NOTE: Temp for now
                const apply_options = <T extends Discord.ApplicationCommandOptionBase>(slash_option: T) =>
                    slash_option
                        .setName(option.title)
                        .setDescription(option.description)
                        .setRequired(!!option.required);
                if (option.type == "string") {
                    djs_command.addStringOption(slash_option => {
                        const opt = option as TextBasedCommandParameterOptionsWithChoices<string>;
                        return apply_options(slash_option)
                            .setChoices(opt.choices ?? [])
                            .setAutocomplete(!!opt.autocomplete);
                    });
                } else if (option.type == "number") {
                    djs_command.addNumberOption(slash_option => {
                        const opt = option as TextBasedCommandParameterOptionsWithChoices<number>;
                        return apply_options(slash_option).setChoices(opt.choices ?? []);
                    });
                } else if (option.type == "boolean") {
                    djs_command.addBooleanOption(slash_option => apply_options(slash_option));
                } else if (option.type == "user") {
                    djs_command.addUserOption(slash_option => apply_options(slash_option));
                } else if (option.type == "role") {
                    djs_command.addRoleOption(slash_option => apply_options(slash_option));
                } else {
                    assert(false, "unhandled option type");
                }
            }
            if (this.permissions !== undefined && djs_command instanceof Discord.SlashCommandBuilder) {
                djs_command.setDefaultMemberPermissions(this.permissions);
            }
            return <B>djs_command;
        }
    }

    async parse_text_arguments(command_obj: TextBasedCommand, message: Discord.Message, command_body: string) {
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
            try {
                const required_arg_error = async () => {
                    return new ParseError(
                        ParseErrorType.RequiredArgument,
                        `Required argument "${option.title}" not found`,
                    );
                };
                const validate_choices = <T>(v: T) => {
                    const opt = option as TextBasedCommandParameterOptionsWithChoices<T>;
                    if (opt.choices && !opt.choices.find(({ name, value }) => v == value)) {
                        throw new ParseError(ParseErrorType.InvalidChoice, `Invalid argument choice ${v}`);
                    }
                    return v;
                };
                if (option.type == "string") {
                    if (option.regex) {
                        const match = command_body.match(option.regex);
                        if (match) {
                            command_options.push(validate_choices(match[0]));
                            command_body = command_body.slice(match[0].length).trim();
                        } else if (!option.required) {
                            command_options.push(null);
                        } else {
                            throw required_arg_error();
                        }
                    } else if (i == this.options.size - 1) {
                        if (command_body !== "") {
                            command_options.push(validate_choices(command_body));
                            command_body = "";
                        } else if (!option.required) {
                            command_options.push(null);
                        } else {
                            throw required_arg_error();
                        }
                    } else {
                        const leading_pattern = BotTextBasedCommand.leading_pattern_for_type(
                            [...this.options.values()][i + 1].type,
                        );
                        if (leading_pattern) {
                            const separator = command_body.search(leading_pattern);
                            if (separator > 0) {
                                command_options.push(validate_choices(command_body.slice(0, separator)));
                                command_body = command_body.slice(separator).trim();
                            } else if (command_body !== "") {
                                command_options.push(validate_choices(command_body));
                                command_body = "";
                            } else if (!option.required) {
                                command_options.push(null);
                            } else {
                                throw required_arg_error();
                            }
                        } else {
                            const match = command_body.match(/^\S+/);
                            if (match) {
                                command_options.push(validate_choices(match[0]));
                                command_body = command_body.slice(match[0].length).trim();
                            } else if (!option.required) {
                                command_options.push(null);
                            } else {
                                throw required_arg_error();
                            }
                        }
                    }
                } else if (option.type == "number") {
                    // TODO: Handle optional number...
                    const re = /^\d+/;
                    const match = command_body.match(re);
                    if (match) {
                        command_options.push(validate_choices(parseInt(match[0])));
                        command_body = command_body.slice(match[0].length).trim();
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        throw required_arg_error();
                    }
                } else if (option.type == "boolean") {
                    const re = /^(?:true|false)/i;
                    const match = command_body.match(re);
                    if (match) {
                        command_options.push(match[0].toLowerCase() === "true");
                        command_body = command_body.slice(match[0].length).trim();
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        throw required_arg_error();
                    }
                } else if (option.type == "user") {
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
                    } else if (message.type === Discord.MessageType.Reply) {
                        // Handle reply as an argument, only if no text argument is provided
                        // NOTE: If there's ever a command like !x <user> <user> this won't quite work
                        try {
                            const reply_message = await this.wheatley.fetch_message_reply(message);
                            command_options.push(reply_message.author);
                        } catch (e) {
                            await reply_with_error(`Error fetching reply`, true);
                            this.wheatley.critical_error(e);
                            return;
                        }
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        throw required_arg_error();
                    }
                } else if (option.type == "users") {
                    const users: Discord.User[] = [];
                    while (true) {
                        const re = /^(?:<@(\d{10,})>|(\d{10,}))+/;
                        const match = command_body.match(re);
                        if (match) {
                            const userid = match[1] || match[2];
                            try {
                                const user = await this.wheatley.client.users.fetch(userid);
                                users.push(user);
                                command_body = command_body.slice(match[0].length).trim();
                            } catch (e) {
                                M.debug(e);
                                await reply_with_error(`Unable to find user`, true);
                                return;
                            }
                        } else {
                            break;
                        }
                    }
                    if (users.length > 0) {
                        command_options.push(users);
                    } else {
                        if (!option.required) {
                            command_options.push(null);
                        } else {
                            throw required_arg_error();
                        }
                    }
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                } else if (option.type == "role") {
                    const re = new RegExp(
                        this.wheatley.guild.roles.cache
                            .map(role => escape_regex(role.name))
                            .filter(name => name !== "@everyone")
                            .join("|"),
                        "i",
                    );
                    const match = command_body.match(re);
                    if (match) {
                        command_options.push(
                            unwrap(
                                this.wheatley.guild.roles.cache.find(
                                    role => role.name.toLowerCase() === match[0].toLowerCase(),
                                ),
                            ),
                        );
                        command_body = command_body.slice(match[0].length).trim();
                    } else if (!option.required) {
                        command_options.push(null);
                    } else {
                        throw required_arg_error();
                    }
                } else {
                    assert(false, "unhandled option type");
                }
            } catch (e) {
                if (e instanceof ParseError) {
                    if (i === 0 && e.error_type === ParseErrorType.RequiredArgument) {
                        await command_obj.reply({ embeds: [this.command_info_and_description_embed()] });
                    } else {
                        await reply_with_error(e.message);
                    }
                    return;
                }
                this.wheatley.critical_error(e);
                return;
            }
        }
        if (command_body != "" && !this.allow_trailing_junk) {
            await reply_with_error(`Unexpected parameters provided`);
            return;
        }
        return command_options as Args;
    }

    get_usage_name_pattern(): string {
        return `${this.slash ? "/⁠" : "!⁠"}${this.display_prefix}${this.all_names.join("|")}`;
    }

    get_usage(): string {
        if (this.subcommands) {
            return this.subcommands.map(command => command.get_usage()).join("\n");
        } else {
            return wrap(
                [
                    this.get_usage_name_pattern(),
                    ...this.options.map(option => (option.required ? `<${option.title}>` : `[${option.title}]`)),
                ].join(" "),
                "`",
            );
        }
    }

    get_command_info(): string {
        if (this.subcommands) {
            return this.get_usage();
        } else {
            return this.get_usage() + " " + this.description;
        }
    }

    command_info_and_description_embed() {
        return new Discord.EmbedBuilder()
            .setTitle(`${this.display_name}`)
            .setDescription(build_description(this.description, "", ...this.get_command_info().split("\n")))
            .setColor(colors.wheatley);
    }
}
