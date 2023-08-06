import { strict as assert } from "assert";
import { M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

const snowflakes_re = /\d+/g;

const DISCORD_EPOCH = 1420070400000;

export function decode_snowflake(snowflake_text: string) {
    const snowflake = BigInt.asUintN(64, BigInt(snowflake_text));
    return DISCORD_EPOCH + Number(snowflake >> 22n); // milliseconds
}

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
                .set_description("snowflake")
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
