import { strict as assert } from "assert";
import { ConditionalOptional } from "../utils/typing.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ApplicationCommandTypeUser = 2;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const ApplicationCommandTypeMessage = 3;

// Button and modal custom ids carry their arguments as base_custom_id:argument:argument...
export type CustomIdParameterType = "string" | "number" | "boolean" | "user_id";

// ":" separates arguments, so it's escaped in string arguments along with the escape character itself. Only these two
// characters are escaped to keep custom ids within Discord's 100 character limit.
function escape_custom_id_argument(argument: string) {
    return argument.replaceAll("%", "%25").replaceAll(":", "%3A");
}

function unescape_custom_id_argument(argument: string) {
    return argument.replace(/%(25|3A)/g, escaped => (escaped === "%25" ? "%" : ":"));
}

export function build_custom_id(base_custom_id: string, types: CustomIdParameterType[], args: unknown[]) {
    assert(
        args.length === types.length,
        `Expected ${types.length} arguments, got ${args.length} for ${base_custom_id}`,
    );
    const serialized_args = args.map((arg, i) =>
        types[i] === "string" ? escape_custom_id_argument(String(arg)) : String(arg),
    );
    return [base_custom_id, ...serialized_args].join(":");
}

export function split_custom_id(custom_id: string): [string, string[]] {
    const [base_custom_id, ...raw_args] = custom_id.split(":");
    return [base_custom_id, raw_args];
}

export function parse_custom_id_arguments(base_custom_id: string, types: CustomIdParameterType[], raw_args: string[]) {
    assert(
        raw_args.length === types.length,
        `Expected ${types.length} arguments, got ${raw_args.length} for ${base_custom_id}`,
    );
    return raw_args.map((arg, i) => {
        if (types[i] === "string") {
            return unescape_custom_id_argument(arg);
        } else if (types[i] === "number") {
            return parseInt(arg, 10);
        } else if (types[i] === "boolean") {
            return arg === "true";
        } else {
            return arg;
        }
    });
}

export abstract class BaseBuilder<HasHandler extends boolean = false, HandlerArgs extends unknown[] = []> {
    handler!: ConditionalOptional<HasHandler, (...args: HandlerArgs) => Promise<void>>;
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
