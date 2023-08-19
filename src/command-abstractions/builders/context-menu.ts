import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ConditionalOptional } from "../../utils.js";
import { ApplicationCommandTypeMessage, ApplicationCommandTypeUser } from "../command.js";
import { BotCommand } from "../descriptors/descriptor.js";
import { OtherCommandBuilder } from "./builder.js";

export class MessageContextMenuCommandBuilder<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.MessageContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.MessageContextMenuCommandInteraction) => any,
    ): MessageContextMenuCommandBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuCommandBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotCommand<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BotCommand(this.name, this.handler) as ConditionalOptional<HasHandler, BotCommand<any>>,
                new Discord.ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeMessage),
            ];
        }
    }
}

export class UserContextMenuCommandBuilder<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.UserContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.UserContextMenuCommandInteraction) => any,
    ): MessageContextMenuCommandBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuCommandBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotCommand<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BotCommand(this.name, this.handler) as ConditionalOptional<HasHandler, BotCommand<any>>,
                new Discord.ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeUser),
            ];
        }
    }
}
