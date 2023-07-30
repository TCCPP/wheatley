import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

/**
 * Adds a /ping command.
 */
export default class Ping extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder([ "ping", "wstatus" ])
                .set_description("ping")
                .set_handler(this.ping.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("echo")
                .set_description("echo")
                .add_string_option({
                    title: "input",
                    description: "The input to echo back",
                    required: true
                })
                .set_handler(this.echo.bind(this))
        );
    }

    async ping(command: TextBasedCommand) {
        M.log("Received ping command");
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setTitle("pong")
            ]
        });
    }

    async echo(command: TextBasedCommand, input: string) {
        M.debug("Received echo command", input);
        await command.reply(input, true);
    }
}
