import { strict as assert } from "assert";
import { ConditionalOptional } from "../utils.js";

export const ApplicationCommandTypeUser = 2;
export const ApplicationCommandTypeMessage = 3;

export abstract class BaseInteractionBuilder<HasHandler extends boolean = false, HandlerArgs extends unknown[] = []> {
    handler: ConditionalOptional<HasHandler, (...args: HandlerArgs) => any>;
    // returns botcommand and djs command to register, if applicable
    abstract to_command_descriptors(): [ConditionalOptional<HasHandler, BaseBotInteraction<any>>, unknown | undefined];
}

export class BaseBotInteraction<Args extends unknown[] = []> {
    constructor(
        public readonly name: string,
        public readonly handler: (...args: Args) => any,
    ) {}
}
