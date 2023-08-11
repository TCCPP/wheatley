import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

const U_ARROW_DOUBLE_UP = "\u23eb";
const U_ARROW_DOUBLE_DOWN = "\u23ec";
const U_ARROW_UP = "\u2B06\uFE0F";
const U_ARROW_DOWN = "\u2B07\uFE0F";
const U_RECORD_BUTTON = "\u23FA\uFE0F";

const OPTIONS = [
    { symbol: U_ARROW_DOUBLE_UP, text: "Strongly Favor" },
    { symbol: U_ARROW_UP, text: "Favor" },
    { symbol: U_RECORD_BUTTON, text: "Neutral" },
    { symbol: U_ARROW_DOWN, text: "Against" },
    { symbol: U_ARROW_DOUBLE_DOWN, text: "Strongly Against" },
];

const DESCRIPTION = OPTIONS.map(({ symbol, text }) => `${symbol} - ${text}`).join("\n");

/**
 * Adds a /bikeshed command for creating polls with responses ranging from
 * strongly favor to strongly against.
 */
export default class Bikeshed extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("bikeshed")
                .set_description("Create a poll from strongly favor to strongly against")
                .add_string_option({
                    title: "title",
                    description: "The title of the poll",
                    required: true,
                })
                .set_handler(Bikeshed.bikeshed),
        );
    }

    static async bikeshed(command: TextBasedCommand, arg: string) {
        M.log("Creating bikeshed poll for question ");
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.color).setTitle(arg).setDescription(DESCRIPTION)],
        });
        for (const option of OPTIONS) {
            const message = await command.response!.fetch();
            // Await in a loop is intentional here.
            // Reactions have to be applied in a consistent order.
            await message.react(option.symbol);
        }
    }
}
