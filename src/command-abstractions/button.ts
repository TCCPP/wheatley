import * as Discord from "discord.js";

import { M } from "../utils/debugging-and-logging.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseBuilder, CustomIdParameterType, build_custom_id, parse_custom_id_arguments } from "./interaction-base.js";

export class BotButtonHandler<Args extends unknown[] = []> {
    constructor(
        public readonly base_custom_id: string,
        public readonly handler: (interaction: Discord.ButtonInteraction, ...args: Args) => Promise<void>,
        public readonly permissions?: bigint,
        private readonly metadata_fields: CustomIdParameterType[] = [],
    ) {}

    parse_arguments(raw_args: string[]): Args {
        return parse_custom_id_arguments(this.base_custom_id, this.metadata_fields, raw_args) as Args;
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
        private readonly metadata_fields: CustomIdParameterType[] = [],
    ) {}

    generate_custom_id(...args: Args): string {
        return build_custom_id(this.base_custom_id, this.metadata_fields, args);
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
    private readonly metadata_fields: CustomIdParameterType[] = [];
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

        return new BotButtonHandler(this.base_custom_id, this.handler, this.permissions, this.metadata_fields);
    }

    build_button(): BotButton<Args> {
        return new BotButton(this.base_custom_id, this.metadata_fields);
    }
}
