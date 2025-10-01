import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley, create_error_reply } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { build_description } from "../utils/strings.js";

export default class Shortcuts extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("nothingtoseehere", "Misc", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Nothing to see here")
                .set_handler(this.nothingtoseehere.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder(["tryitandsee", "tias"], "Misc", EarlyReplyMode.none)
                .set_description("Try it and see")
                .set_handler(this.tryitandsee.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("headbang", "Misc", EarlyReplyMode.none)
                .set_description("Headbang")
                .set_handler(this.headbang.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("initgif", "Misc", EarlyReplyMode.none)
                .set_description("initgif")
                .set_handler(this.initgif.bind(this)),
        );
    }

    async nothingtoseehere(command: TextBasedCommand) {
        await command.reply("https://youtu.be/NuAKnbIr6TE");
    }

    async tryitandsee(command: TextBasedCommand) {
        await command.reply("https://tryitands.ee/");
    }

    async headbang(command: TextBasedCommand) {
        await command.reply("<a:headbang:1230177508540809216>");
    }

    async initgif(command: TextBasedCommand) {
        await command.reply({
            files: ["https://mikelui.io/img/c++_init_forest.gif"],
        });
    }
}
