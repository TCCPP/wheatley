import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { ConditionalOptional } from "../utils/typing.js";
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
    permissions: undefined | bigint = undefined;

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.MessageContextMenuCommandInteraction) => Promise<void>,
    ): MessageContextMenuInteractionBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuInteractionBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BaseBotInteraction<any>>, undefined];
        } else {
            return [
                new BaseBotInteraction(this.name, this.handler) as ConditionalOptional<
                    HasHandler,
                    BaseBotInteraction<any>
                >,
                new Discord.ContextMenuCommandBuilder()
                    .setName(this.name)
                    .setDefaultMemberPermissions(this.permissions)
                    .setType(ApplicationCommandTypeMessage),
            ];
        }
    }

    set_permissions(permissions: bigint) {
        this.permissions = permissions;
        return this;
    }
}

export class UserContextMenuInteractionBuilder<HasHandler extends boolean = false> extends BaseInteractionBuilder<
    HasHandler,
    [Discord.UserContextMenuCommandInteraction]
> {
    permissions: undefined | bigint = undefined;

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.UserContextMenuCommandInteraction) => Promise<void>,
    ): MessageContextMenuInteractionBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuInteractionBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BaseBotInteraction<any>>, undefined];
        } else {
            return [
                new BaseBotInteraction(this.name, this.handler) as ConditionalOptional<
                    HasHandler,
                    BaseBotInteraction<any>
                >,
                new Discord.ContextMenuCommandBuilder()
                    .setName(this.name)
                    .setDefaultMemberPermissions(this.permissions)
                    .setType(ApplicationCommandTypeUser),
            ];
        }
    }

    set_permissions(permissions: bigint) {
        this.permissions = permissions;
        return this;
    }
}
