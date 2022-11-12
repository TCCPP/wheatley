import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils";
import { colors } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { Command, CommandBuilder } from "../command";

export class Ping extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new CommandBuilder([ "ping", "wstatus" ])
                .set_description("ping")
                .set_handler(this.ping.bind(this))
        );

        this.add_command(
            new CommandBuilder("echo")
                .set_description("echo")
                .add_string_option({
                    title: "input",
                    description: "The input to echo back",
                    required: true
                })
                .set_handler(this.echo.bind(this))
        );
    }

    async ping(command: Command) {
        M.log("Received ping command");
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setTitle("pong")
            ]
        });
    }

    async echo(command: Command, input: string) {
        M.debug("Received echo command", input);
        await command.reply({
            ephemeral_if_possible: true,
            content: input
        });
    }
}
