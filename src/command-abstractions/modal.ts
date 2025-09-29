import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseInteractionBuilder, BaseBotInteraction } from "./interaction-base.js";
import { M } from "../utils/debugging-and-logging.js";
import { BaseBuilder } from "./interaction-base.js";

export type ModalParameterType = "string" | "number" | "boolean" | "user_id";

export type ModalField = {
    custom_id: string;
    label: string;
    style: Discord.TextInputStyle;
    placeholder?: string;
    required?: boolean;
    min_length?: number;
    max_length?: number;
    value?: string;
};

export class BotModalHandler<Args extends unknown[] = []> {
    private readonly metadata_fields: ModalParameterType[] = [];
    private readonly field_configs: ModalField[] = [];

    constructor(
        public readonly base_custom_id: string,
        public readonly handler: (interaction: Discord.ModalSubmitInteraction, ...args: Args) => Promise<void>,
        public readonly permissions?: bigint,
        metadata_fields: ModalParameterType[] = [],
        field_configs: ModalField[] = [],
    ) {
        this.metadata_fields = metadata_fields;
        this.field_configs = field_configs;
    }

    get fields(): string[] {
        return this.field_configs.map(field => field.custom_id);
    }

    parse_arguments(raw_args: string[]): Args {
        assert(
            raw_args.length === this.metadata_fields.length,
            `Expected ${this.metadata_fields.length} arguments, got ${raw_args.length} ` +
                `for modal ${this.base_custom_id}`,
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
                throw new Error(`Failed to parse argument ${index} for modal ${this.base_custom_id}: ${error}`);
            }
        }) as Args;
    }

    async handle(interaction: Discord.ModalSubmitInteraction, raw_args: string[]): Promise<void> {
        M.log(
            `Received modal interaction ${this.base_custom_id}`,
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
            M.error(`Error handling modal ${this.base_custom_id}:`, error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "An error occurred while processing this modal",
                    ephemeral: true,
                });
            }

            throw error;
        }
    }
}

export class BotModal<Args extends unknown[] = []> {
    constructor(
        public readonly base_custom_id: string,
        private readonly title: string,
        private readonly metadata_fields: ModalParameterType[] = [],
        private readonly field_configs: ModalField[] = [],
    ) {}

    generate_custom_id(...args: Args): string {
        assert(
            args.length === this.metadata_fields.length,
            `Expected ${this.metadata_fields.length} arguments, got ${args.length} for modal ${this.base_custom_id}`,
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
                throw new Error(`Failed to serialize argument ${index} for modal ${this.base_custom_id}: ${error}`);
            }
        });

        if (serialized_args.length === 0) {
            return this.base_custom_id;
        }

        return `${this.base_custom_id}:${serialized_args.join(":")}`;
    }

    create_modal(...args: Args): Discord.ModalBuilder {
        const custom_id = this.generate_custom_id(...args);

        // Discord custom_id limit is 100 characters
        if (custom_id.length > 100) {
            throw new Error(
                `Generated custom_id "${custom_id}" is ${custom_id.length} characters, ` +
                    `exceeds Discord's 100 character limit for modal ${this.base_custom_id}`,
            );
        }

        const modal = new Discord.ModalBuilder().setCustomId(custom_id).setTitle(this.title);

        // Group fields into rows (max 5 components per row, max 5 rows)
        const rows: Discord.ActionRowBuilder<Discord.TextInputBuilder>[] = [];
        let current_row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>();
        let components_in_row = 0;

        for (const field of this.field_configs) {
            if (components_in_row >= 5) {
                rows.push(current_row);
                current_row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>();
                components_in_row = 0;
            }

            const text_input = new Discord.TextInputBuilder()
                .setCustomId(field.custom_id)
                .setLabel(field.label)
                .setStyle(field.style);

            if (field.placeholder !== undefined) {
                text_input.setPlaceholder(field.placeholder);
            }
            if (field.required !== undefined) {
                text_input.setRequired(field.required);
            }
            if (field.min_length !== undefined) {
                text_input.setMinLength(field.min_length);
            }
            if (field.max_length !== undefined) {
                text_input.setMaxLength(field.max_length);
            }
            if (field.value !== undefined) {
                text_input.setValue(field.value);
            }

            current_row.addComponents(text_input);
            components_in_row++;
        }

        if (components_in_row > 0) {
            rows.push(current_row);
        }

        modal.addComponents(...rows);
        return modal;
    }

    get_field_value(interaction: Discord.ModalSubmitInteraction, field_custom_id: string): string {
        return interaction.fields.getTextInputValue(field_custom_id);
    }

    get_all_field_values(interaction: Discord.ModalSubmitInteraction): Record<string, string> {
        const values: Record<string, string> = {};
        for (const field of this.field_configs) {
            values[field.custom_id] = this.get_field_value(interaction, field.custom_id);
        }
        return values;
    }
}

export class ModalInteractionBuilder<
    Args extends unknown[] = [],
    HasHandler extends boolean = false,
> extends BaseBuilder<HasHandler, [Discord.ModalSubmitInteraction, ...Args]> {
    private readonly metadata_fields: ModalParameterType[] = [];
    private permissions?: bigint;
    private title = "Modal";
    private readonly field_configs: ModalField[] = [];

    constructor(public readonly base_custom_id: string) {
        super();
    }

    set_title(title: string): ModalInteractionBuilder<Args, HasHandler> {
        this.title = title;
        return this;
    }

    add_string_metadata(): ModalInteractionBuilder<[...Args, string], HasHandler> {
        this.metadata_fields.push("string");
        return this as unknown as ModalInteractionBuilder<[...Args, string], HasHandler>;
    }

    add_number_metadata(): ModalInteractionBuilder<[...Args, number], HasHandler> {
        this.metadata_fields.push("number");
        return this as unknown as ModalInteractionBuilder<[...Args, number], HasHandler>;
    }

    add_boolean_metadata(): ModalInteractionBuilder<[...Args, boolean], HasHandler> {
        this.metadata_fields.push("boolean");
        return this as unknown as ModalInteractionBuilder<[...Args, boolean], HasHandler>;
    }

    add_user_id_metadata(): ModalInteractionBuilder<[...Args, string], HasHandler> {
        this.metadata_fields.push("user_id");
        return this as unknown as ModalInteractionBuilder<[...Args, string], HasHandler>;
    }

    add_text_field(field: ModalField): ModalInteractionBuilder<Args, HasHandler> {
        this.field_configs.push(field);
        return this;
    }

    add_short_text_field(
        custom_id: string,
        label: string,
        options: Partial<Pick<ModalField, "placeholder" | "required" | "min_length" | "max_length" | "value">> = {},
    ): ModalInteractionBuilder<Args, HasHandler> {
        return this.add_text_field({
            custom_id,
            label,
            style: Discord.TextInputStyle.Short,
            ...options,
        });
    }

    add_paragraph_field(
        custom_id: string,
        label: string,
        options: Partial<Pick<ModalField, "placeholder" | "required" | "min_length" | "max_length" | "value">> = {},
    ): ModalInteractionBuilder<Args, HasHandler> {
        return this.add_text_field({
            custom_id,
            label,
            style: Discord.TextInputStyle.Paragraph,
            ...options,
        });
    }

    set_handler(
        handler: (interaction: Discord.ModalSubmitInteraction, ...args: Args) => Promise<void>,
    ): ModalInteractionBuilder<Args, true> {
        this.handler = handler;
        return this as unknown as ModalInteractionBuilder<Args, true>;
    }

    set_permissions(permissions: bigint): ModalInteractionBuilder<Args, HasHandler> {
        this.permissions = permissions;
        return this;
    }

    build_handler(): ConditionalOptional<HasHandler, BotModalHandler<Args>> {
        if (!this.handler) {
            return undefined as ConditionalOptional<HasHandler, BotModalHandler<Args>>;
        }

        return new BotModalHandler(
            this.base_custom_id,
            this.handler,
            this.permissions,
            this.metadata_fields,
            this.field_configs,
        ) as ConditionalOptional<HasHandler, BotModalHandler<Args>>;
    }

    build_modal(): BotModal<Args> {
        return new BotModal(this.base_custom_id, this.title, this.metadata_fields, this.field_configs);
    }
}
