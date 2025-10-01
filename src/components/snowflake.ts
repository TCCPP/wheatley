import { strict as assert } from "assert";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { decode_snowflake, discord_timestamp } from "../utils/discord.js";

const snowflakes_re = /\d+/g;

export default class Snowflake extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("snowflake", "Utility", EarlyReplyMode.none)
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
                match.map(snowflake => `${snowflake}: ${discord_timestamp(decode_snowflake(snowflake))}`).join("\n"),
                true,
            );
        }
    }
}
