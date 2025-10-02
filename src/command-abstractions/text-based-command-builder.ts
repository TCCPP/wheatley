import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ConditionalOptional, MoreThanOne, ConditionalNull } from "../utils/typing.js";
import { Append } from "../utils/typing.js";
import { TextBasedCommand } from "./text-based-command.js";
import { BaseBuilder } from "./interaction-base.js";
import { BotTextBasedCommand } from "./text-based-command-descriptor.js";
import { Wheatley } from "../wheatley.js";
import { zip } from "../utils/iterables.js";
import { intersection } from "../utils/arrays.js";

export type TextBasedCommandOptionType = "string" | "number" | "boolean" | "user" | "users" | "role";

export type TextBasedCommandParameterOptions = {
    title: string;
    description: string;
    required: boolean;
    regex?: RegExp; // TODO: Should it not apply to slash command fields?
    autocomplete?: (partial: string, command_name: string) => { name: string; value: string }[];
};

export type CommandCategory =
    | "Wiki Articles"
    | "Wiki Shortcuts"
    | "References"
    | "Thread Control"
    | "Utility"
    | "Misc"
    | "Moderation"
    | "Rolepersist Shortcuts"
    | "Moderation Utilities"
    | "Admin utilities"
    | "Hidden";

export enum EarlyReplyMode {
    ephemeral,
    visible,
    none,
}

export class TextBasedCommandBuilder<
    Args extends unknown[] = [],
    HasDescriptions extends boolean = false,
    HasHandler extends boolean = false,
    HasSubcommands extends boolean = false,
> extends BaseBuilder<HasHandler, [TextBasedCommand, ...Args]> {
    readonly names: string[];
    early_reply_mode: EarlyReplyMode;
    descriptions!: ConditionalOptional<HasDescriptions, string[]>;
    options = new Discord.Collection<string, TextBasedCommandParameterOptions & { type: TextBasedCommandOptionType }>();
    slash_config: boolean[];
    permissions: bigint | undefined = undefined;
    category: CommandCategory | undefined = undefined;
    alias_of: string | undefined = undefined;
    subcommands: TextBasedCommandBuilder<any, true, true>[] = [];
    type: HasSubcommands extends true ? "top-level" : "default";
    allow_trailing_junk: boolean = false;

    constructor(names: string | MoreThanOne<string>, early_reply_mode: EarlyReplyMode) {
        super();
        this.names = Array.isArray(names) ? names : [names];
        this.early_reply_mode = early_reply_mode;
        this.slash_config = new Array(this.names.length).fill(true);
        this.type = "default" as any;
    }

    set_description(
        raw_descriptions: string | MoreThanOne<string>,
    ): TextBasedCommandBuilder<Args, true, HasHandler, HasSubcommands> {
        const descriptions = Array.isArray(raw_descriptions) ? raw_descriptions : [raw_descriptions];
        if (descriptions.length == this.names.length) {
            this.descriptions = descriptions;
        } else {
            assert(descriptions.length == 1);
            this.descriptions = new Array(this.names.length).fill(descriptions[0]);
        }
        return this as unknown as TextBasedCommandBuilder<Args, true, HasHandler, HasSubcommands>;
    }

    add_string_option<O extends TextBasedCommandParameterOptions>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], string>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "string",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], string>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    add_number_option<O extends TextBasedCommandParameterOptions>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], number>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "number",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], number>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    add_boolean_option<O extends TextBasedCommandParameterOptions>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], boolean>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "boolean",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], boolean>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    add_user_option<O extends Omit<TextBasedCommandParameterOptions, "autocomplete" | "regex">>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], Discord.User>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "user",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], Discord.User>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    add_users_option<O extends Omit<TextBasedCommandParameterOptions, "autocomplete" | "regex">>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], Discord.User[]>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "users",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], Discord.User[]>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    add_role_option<O extends Omit<TextBasedCommandParameterOptions, "autocomplete" | "regex">>(
        option: O,
    ): TextBasedCommandBuilder<
        Append<Args, ConditionalNull<O["required"], Discord.Role>>,
        HasDescriptions,
        HasHandler,
        HasSubcommands
    > {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "role",
        });
        return this as unknown as TextBasedCommandBuilder<
            Append<Args, ConditionalNull<O["required"], Discord.Role>>,
            HasDescriptions,
            HasHandler,
            HasSubcommands
        >;
    }

    set_handler(
        handler: (x: TextBasedCommand, ...args: Args) => Promise<void>,
    ): TextBasedCommandBuilder<Args, HasDescriptions, true> {
        this.handler = handler;
        return this as unknown as TextBasedCommandBuilder<Args, HasDescriptions, true>;
    }

    set_slash(...config: boolean[]) {
        if (config.length == this.names.length) {
            this.slash_config = config;
        } else {
            assert(config.length == 1);
            this.slash_config = new Array(this.names.length).fill(config[0]);
        }
        return this;
    }

    set_permissions(permissions: bigint) {
        this.permissions = permissions;
        return this;
    }

    set_category(category: CommandCategory) {
        this.category = category;
        return this;
    }

    set_alias_of(command_name: string) {
        this.alias_of = command_name;
        return this;
    }

    set_allow_trailing_junk(allow_trailing_junk: boolean) {
        this.allow_trailing_junk = allow_trailing_junk;
        return this;
    }

    add_subcommand<T extends unknown[]>(subcommand: TextBasedCommandBuilder<T, true, true>) {
        assert(
            this.subcommands.every(
                some_subcommand => intersection(some_subcommand.names, subcommand.names).length === 0,
            ),
        );
        this.subcommands.push(subcommand);
        this.type = "top-level" as any;
        // TODO: Maybe re-evaluate typing
        return this as unknown as TextBasedCommandBuilder<Args, HasDescriptions, HasHandler, true>;
    }

    to_command_descriptors(
        this: TextBasedCommandBuilder<Args, true, true> | TextBasedCommandBuilder<Args, true, false, true>,
        wheatley: Wheatley,
    ): BotTextBasedCommand<unknown[]>[] {
        const descriptors: BotTextBasedCommand<unknown[]>[] = [];
        if (this.type === "top-level") {
            assert(this.subcommands.length > 0);
            assert(this.names.length === 1);
        }
        assert(this.names.length > 0);
        assert(this.names.length == this.descriptions.length);
        assert(this.names.length == this.slash_config.length);
        for (const [name, description, slash] of zip(this.names, this.descriptions, this.slash_config)) {
            descriptors.push(
                new BotTextBasedCommand(
                    name,
                    "",
                    description,
                    slash,
                    this.permissions,
                    this.category,
                    this.alias_of,
                    this.allow_trailing_junk,
                    this.early_reply_mode,
                    this,
                    wheatley,
                ) as BotTextBasedCommand<unknown[]>,
            );
        }
        return descriptors;
    }
}
