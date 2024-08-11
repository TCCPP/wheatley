import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { ConditionalOptional } from "../utils/typing.js";
import { BaseInteractionBuilder, BaseBotInteraction } from "./interaction-base.js";

export class ButtonInteractionBuilder<HasHandler extends boolean = false> extends BaseInteractionBuilder<
    HasHandler,
    [Discord.ButtonInteraction]
> {
    readonly name: string;
    permissions: undefined | bigint = undefined;

    constructor(button: Discord.ButtonBuilder, handler: (x: Discord.ButtonInteraction) => Promise<void>) {
        super();
        assert("custom_id" in button.data);
        this.name = unwrap(button.data.custom_id);
        this.handler = handler;
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
                undefined,
            ];
        }
    }

    set_permissions(permissions: bigint) {
        this.permissions = permissions;
        return this;
    }
}
