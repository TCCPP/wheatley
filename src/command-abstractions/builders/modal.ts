import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap, ConditionalOptional } from "../../utils.js";
import { BotModalHandler } from "../descriptors/modal.js";
import { OtherCommandBuilder } from "./builder.js";

export class ModalHandler<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.ModalSubmitInteraction, ...string[]]
> {
    readonly name: string;
    readonly fields: string[];

    constructor(modal: Discord.ModalBuilder, handler: (x: Discord.ModalSubmitInteraction, ...args: string[]) => any) {
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
                new BotModalHandler(this.name, this as ModalHandler<true>) as ConditionalOptional<
                    HasHandler,
                    BotModalHandler
                >,
                undefined,
            ];
        }
    }
}
