import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Ping extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder(["ping", "wstatus"]).set_description("Ping").set_handler(this.ping.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("echo")
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
