import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ModalHandler } from "../builders/modal.js";
import { BotCommand } from "./descriptor.js";

export class BotModalHandler extends BotCommand<[Discord.ModalSubmitInteraction, ...string[]]> {
    fields: string[];

    constructor(name: string, modal: ModalHandler<true>) {
        super(name, modal.handler);
        this.fields = modal.fields;
    }
}
