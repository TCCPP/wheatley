import { strict as assert } from "assert";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

const snowflakes_re = /\d+/g;

const DISCORD_EPOCH = 1420070400000;

/**
 * Decode a snowflake as milliseconds
 */
export function decode_snowflake(snowflake_text: string) {
    const snowflake = BigInt.asUintN(64, BigInt(snowflake_text));
    return DISCORD_EPOCH + Number(snowflake >> 22n); // milliseconds
}

/**
 * Milliseconds to snowflake
 */
export function forge_snowflake(timestamp: number) {
    assert(timestamp > DISCORD_EPOCH);
    const snowflake = BigInt(timestamp - DISCORD_EPOCH) << 22n;
    return snowflake.toString();
}

/**
 * Adds the /snowflake command.
 */
export default class Snowflake extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("snowflake")
                .set_description("Snowflake")
                .add_string_option({
                    title: "input",
                    description: "Input",
                    required: true,
                })
                .set_handler(this.snowflake.bind(this)),
        );
    }

    async snowflake(command: TextBasedCommand, input: string) {
        const match = input.match(snowflakes_re);
        if (match != null) {
            await command.reply(
                match
                    .map(snowflake => `${snowflake}: <t:${Math.round(decode_snowflake(snowflake) / 1000)}>`)
                    .join("\n"),
                true,
            );
        }
    }
}
