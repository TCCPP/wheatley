import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseInteractionBuilder, BaseBotInteraction } from "./interaction-base.js";

export class ModalInteractionBuilder extends BaseInteractionBuilder<
    true,
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

    override to_command_descriptors(): [BotModalHandler, undefined] {
        return [new BotModalHandler(this.name, this as ModalInteractionBuilder), undefined];
    }
}

export class BotModalHandler extends BaseBotInteraction<[Discord.ModalSubmitInteraction, ...string[]]> {
    fields: string[];

    constructor(name: string, modal: ModalInteractionBuilder) {
        super(name, modal.handler);
        this.fields = modal.fields;
    }
}
