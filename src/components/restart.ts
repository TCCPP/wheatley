import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Restart extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("restart")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Restart")
                .set_handler(this.restart.bind(this)),
        );
    }

    async restart(command: TextBasedCommand) {
        await command.reply("Received restart command", true);
        process.exit();
    }
}
