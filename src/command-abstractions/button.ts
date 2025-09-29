import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { M } from "../utils/debugging-and-logging.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseBuilder } from "./interaction-base.js";

export type ButtonParameterType = "string" | "number" | "boolean" | "user_id";

export class BotButtonHandler<Args extends unknown[] = []> {
    private readonly metadata_fields: ButtonParameterType[] = [];

    constructor(
        public readonly base_custom_id: string,
        public readonly handler: (interaction: Discord.ButtonInteraction, ...args: Args) => Promise<void>,
        public readonly permissions?: bigint,
        metadata_fields: ButtonParameterType[] = [],
    ) {
        this.metadata_fields = metadata_fields;
    }

    parse_arguments(raw_args: string[]): Args {
        assert(
            raw_args.length === this.metadata_fields.length,
            `Expected ${this.metadata_fields.length} arguments, got ${raw_args.length} ` +
                `for button ${this.base_custom_id}`,
        );

        return raw_args.map((arg, index) => {
            const type = this.metadata_fields[index];
            try {
                if (type === "string" || type === "user_id") {
                    return arg;
                } else if (type === "number") {
                    return parseInt(arg, 10);
                } else if (
                    type === "boolean" // eslint-disable-line @typescript-eslint/no-unnecessary-condition
                ) {
                    return arg === "true";
                } else {
                    throw new Error(`Unknown parameter type: ${type}`);
                }
            } catch (error) {
                throw new Error(`Failed to parse argument ${index} for button ${this.base_custom_id}: ${error}`);
            }
        }) as Args;
    }

    async handle(interaction: Discord.ButtonInteraction, raw_args: string[]): Promise<void> {
        M.log(
            `Received button interaction ${this.base_custom_id}`,
            "From:",
            interaction.user.tag,
            interaction.user.id,
            "Args:",
            raw_args,
        );

        try {
            const parsed_args = this.parse_arguments(raw_args);
            await this.handler(interaction, ...parsed_args);
        } catch (error) {
            M.error(`Error handling button ${this.base_custom_id}:`, error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "An error occurred while processing this button",
                    ephemeral: true,
                });
            }

            throw error;
        }
    }
}

export class BotButton<Args extends unknown[] = []> {
    constructor(
        public readonly base_custom_id: string,
        private readonly metadata_fields: ButtonParameterType[] = [],
    ) {}

    generate_custom_id(...args: Args): string {
        assert(
            args.length === this.metadata_fields.length,
            `Expected ${this.metadata_fields.length} arguments, got ${args.length} for button ${this.base_custom_id}`,
        );

        const serialized_args = args.map((arg, index) => {
            const type = this.metadata_fields[index];
            try {
                if (type === "string" || type === "user_id") {
                    return String(arg);
                } else if (type === "number") {
                    return String(arg);
                } else if (
                    type === "boolean" // eslint-disable-line @typescript-eslint/no-unnecessary-condition
                ) {
                    return String(arg);
                } else {
                    throw new Error(`Unknown parameter type: ${type}`);
                }
            } catch (error) {
                throw new Error(`Failed to serialize argument ${index} for button ${this.base_custom_id}: ${error}`);
            }
        });

        if (serialized_args.length === 0) {
            return this.base_custom_id;
        }

        return `${this.base_custom_id}:${serialized_args.join(":")}`;
    }

    create_button(...args: Args): Discord.ButtonBuilder {
        const custom_id = this.generate_custom_id(...args);

        // Discord custom_id limit is 100 characters
        if (custom_id.length > 100) {
            throw new Error(
                `Generated custom_id "${custom_id}" is ${custom_id.length} characters, ` +
                    `exceeds Discord's 100 character limit for button ${this.base_custom_id}`,
            );
        }

        return new Discord.ButtonBuilder().setCustomId(custom_id);
    }
}

export class ButtonInteractionBuilder<
    Args extends unknown[] = [],
    HasHandler extends boolean = false,
> extends BaseBuilder<HasHandler, [Discord.ButtonInteraction, ...Args]> {
    private readonly metadata_fields: ButtonParameterType[] = [];
    private permissions?: bigint;

    constructor(public readonly base_custom_id: string) {
        super();
    }

    add_string_metadata(): ButtonInteractionBuilder<[...Args, string], HasHandler> {
        this.metadata_fields.push("string");
        return this as unknown as ButtonInteractionBuilder<[...Args, string], HasHandler>;
    }

    add_number_metadata(): ButtonInteractionBuilder<[...Args, number], HasHandler> {
        this.metadata_fields.push("number");
        return this as unknown as ButtonInteractionBuilder<[...Args, number], HasHandler>;
    }

    add_boolean_metadata(): ButtonInteractionBuilder<[...Args, boolean], HasHandler> {
        this.metadata_fields.push("boolean");
        return this as unknown as ButtonInteractionBuilder<[...Args, boolean], HasHandler>;
    }

    add_user_id_metadata(): ButtonInteractionBuilder<[...Args, string], HasHandler> {
        this.metadata_fields.push("user_id");
        return this as unknown as ButtonInteractionBuilder<[...Args, string], HasHandler>;
    }

    set_handler(
        handler: (interaction: Discord.ButtonInteraction, ...args: Args) => Promise<void>,
    ): ButtonInteractionBuilder<Args, true> {
        this.handler = handler;
        return this as unknown as ButtonInteractionBuilder<Args, true>;
    }

    set_permissions(permissions: bigint): ButtonInteractionBuilder<Args, HasHandler> {
        this.permissions = permissions;
        return this;
    }

    build_handler(): ConditionalOptional<HasHandler, BotButtonHandler<Args>> {
        if (!this.handler) {
            return undefined as ConditionalOptional<HasHandler, BotButtonHandler<Args>>;
        }

        return new BotButtonHandler(
            this.base_custom_id,
            this.handler,
            this.permissions,
            this.metadata_fields,
        ) as ConditionalOptional<HasHandler, BotButtonHandler<Args>>;
    }

    build_button(): BotButton<Args> {
        return new BotButton(this.base_custom_id, this.metadata_fields);
    }
}
