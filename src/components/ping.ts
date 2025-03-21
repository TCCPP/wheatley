import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Ping extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder(["ping", "wstatus"], EarlyReplyMode.none)
                .set_description("Ping")
                .set_handler(this.ping.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("echo", EarlyReplyMode.none)
                .set_description("Echo")
                .add_string_option({
                    title: "input",
                    description: "The input to echo back",
                    required: true,
                })
                .set_handler(this.echo.bind(this)),
        );
    }

    async ping(command: TextBasedCommand) {
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle("pong")],
        });
    }

    async echo(command: TextBasedCommand, input: string) {
        M.debug("Received echo command", input);
        await command.reply(input, true);
    }
}
