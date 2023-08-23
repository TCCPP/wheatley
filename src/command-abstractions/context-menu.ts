import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ConditionalOptional } from "../utils.js";
import {
    BaseInteractionBuilder,
    ApplicationCommandTypeMessage,
    ApplicationCommandTypeUser,
    BaseBotInteraction,
} from "./interaction-base.js";

export class MessageContextMenuInteractionBuilder<HasHandler extends boolean = false> extends BaseInteractionBuilder<
    HasHandler,
    [Discord.MessageContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.MessageContextMenuCommandInteraction) => any,
    ): MessageContextMenuInteractionBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuInteractionBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BaseBotInteraction<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BaseBotInteraction(this.name, this.handler) as ConditionalOptional<
                    HasHandler,
                    BaseBotInteraction<any>
                >,
                new Discord.ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeMessage),
            ];
        }
    }
}

export class UserContextMenuInteractionBuilder<HasHandler extends boolean = false> extends BaseInteractionBuilder<
    HasHandler,
    [Discord.UserContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.UserContextMenuCommandInteraction) => any,
    ): MessageContextMenuInteractionBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuInteractionBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BaseBotInteraction<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BaseBotInteraction(this.name, this.handler) as ConditionalOptional<
                    HasHandler,
                    BaseBotInteraction<any>
                >,
                new Discord.ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeUser),
            ];
        }
    }
}
