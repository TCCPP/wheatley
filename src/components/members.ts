import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Members extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("members").set_description("Members").set_handler(this.members.bind(this)),
        );
    }

    async members(command: TextBasedCommand) {
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle("Members")
                    .setDescription(`Total: ${this.wheatley.TCCPP.members.cache.size} members`),
            ],
        });
    }
}
