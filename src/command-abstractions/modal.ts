import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseInteractionBuilder, BaseBotInteraction } from "./interaction-base.js";

export class ModalInteractionBuilder<HasHandler extends boolean = false> extends BaseInteractionBuilder<
    HasHandler,
    [Discord.ModalSubmitInteraction, ...string[]]
> {
    readonly name: string;
    readonly fields: string[];

    constructor(
        modal: Discord.ModalBuilder,
        handler: (x: Discord.ModalSubmitInteraction, ...args: string[]) => Promise<void>,
    ) {
        super();
        assert(modal.data.custom_id);
        this.name = unwrap(modal.data.custom_id);
        this.fields = modal.components
            .map(row => row.components.map(component => unwrap(component.data.custom_id)))
            .flat();
        this.handler = handler;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotModalHandler>, undefined] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotModalHandler>, undefined];
        } else {
            return [
                new BotModalHandler(this.name, this as ModalInteractionBuilder<true>) as ConditionalOptional<
                    HasHandler,
                    BotModalHandler
                >,
                undefined,
            ];
        }
    }
}

export class BotModalHandler extends BaseBotInteraction<[Discord.ModalSubmitInteraction, ...string[]]> {
    fields: string[];

    constructor(name: string, modal: ModalInteractionBuilder<true>) {
        super(name, modal.handler);
        this.fields = modal.fields;
    }
}
