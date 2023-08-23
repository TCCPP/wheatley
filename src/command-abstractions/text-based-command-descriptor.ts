import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { critical_error, zip } from "../utils.js";
import {
    TextBasedCommandParameterOptions,
    TextBasedCommandOptionType,
    TextBasedCommandBuilder,
} from "./text-based-command-builder.js";
import { TextBasedCommand } from "./text-based-command.js";

export class BotTextBasedCommand<Args extends unknown[] = []> {
    public readonly options = new Discord.Collection<
        string,
        TextBasedCommandParameterOptions & { type: TextBasedCommandOptionType }
    >();
    public readonly handler: (...args: [TextBasedCommand, ...Args]) => any;
    public readonly subcommands: Map<string, BotTextBasedCommand<any>> | null = null;

    constructor(
        public readonly name: string,
        public readonly description: string | undefined,
        public readonly slash: boolean,
        public readonly permissions: undefined | bigint,
        builder: TextBasedCommandBuilder<Args, true, true> | TextBasedCommandBuilder<Args, true, false, true>,
    ) {
        this.options = builder.options;
        this.handler = builder.handler ?? (() => critical_error("This shouldn't happen"));
        if (builder.type === "top-level") {
            this.subcommands = new Map();
            for (const subcommand of builder.subcommands) {
                for (const [sub_name, sub_description, sub_slash] of zip(
                    subcommand.names,
                    subcommand.descriptions,
                    subcommand.slash_config,
                )) {
                    assert(!this.subcommands.has(sub_name));
                    this.subcommands.set(
                        sub_name,
                        new BotTextBasedCommand(sub_name, sub_description, sub_slash, builder.permissions, subcommand),
                    );
                }
            }
        }
    }
}
