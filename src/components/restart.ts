import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class Restart extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("restart", "Misc", EarlyReplyMode.none)
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
