import { strict as assert } from "assert";
import { ConditionalOptional } from "../utils/typing.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ApplicationCommandTypeUser = 2;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ApplicationCommandTypeMessage = 3;

export abstract class BaseBuilder<HasHandler extends boolean = false, HandlerArgs extends unknown[] = []> {
    handler: ConditionalOptional<HasHandler, (...args: HandlerArgs) => Promise<void>>;
}

export abstract class BaseInteractionBuilder<
    HasHandler extends boolean = false,
    HandlerArgs extends unknown[] = [],
> extends BaseBuilder<HasHandler, HandlerArgs> {
    // returns botcommand and djs command to register, if applicable
    abstract to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown | undefined];
}

export class BaseBotInteraction<Args extends unknown[] = []> {
    constructor(
        public readonly name: string,
        public readonly handler: (...args: Args) => Promise<void>,
    ) {}
}
