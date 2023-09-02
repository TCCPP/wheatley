import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ConditionalOptional, MoreThanOne, Append, intersection, ConditionalNull } from "../utils.js";
import { TextBasedCommand } from "./text-based-command.js";
import { BaseBuilder } from "./interaction-base.js";

export type TextBasedCommandOptionType = "string" | "number" | "user" | "role";

export type TextBasedCommandParameterOptions = {
    title: string;
    description: string;
    required: boolean;
    regex?: RegExp; // TODO: Should it not apply to slash command fields?
    autocomplete?: (partial: string, command_name: string) => { name: string; value: string }[];
};

export class TextBasedCommandBuilder<
    Args extends unknown[] = [],
    HasDescriptions extends boolean = false,
    HasHandler extends boolean = false,
    HasSubcommands extends boolean = false,
> extends BaseBuilder<HasHandler, [TextBasedCommand, ...Args]> {
    readonly names: string[];
    descriptions: ConditionalOptional<HasDescriptions, string[]>;
    options = new Discord.Collection<string, TextBasedCommandParameterOptions & { type: TextBasedCommandOptionType }>();
    slash_config: boolean[];
    permissions: undefined | bigint = undefined;
    subcommands: TextBasedCommandBuilder<any, true, true>[] = [];
    type: HasSubcommands extends true ? "top-level" : "default";

    constructor(names: string | MoreThanOne<string>) {
        super();
        this.names = Array.isArray(names) ? names : [names];
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

    // TODO: to_command_descriptors?
}
