import { ConditionalOptional } from "../../utils.js";

import { BotCommand } from "../descriptors/descriptor.js";

export abstract class CommandBuilder<HasHandler extends boolean = false, HandlerArgs extends unknown[] = []> {
    handler: ConditionalOptional<HasHandler, (...args: HandlerArgs) => any>;
}

export abstract class OtherCommandBuilder<
    HasHandler extends boolean = false,
    HandlerArgs extends unknown[] = [],
> extends CommandBuilder<HasHandler, HandlerArgs> {
    // returns botcommand and djs command to register, if applicable
    abstract to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown | undefined];
}
