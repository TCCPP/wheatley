import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley, create_error_reply } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { build_description } from "../utils/strings.js";

export default class Shortcuts extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("nothingtoseehere", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Nothing to see here")
                .set_handler(this.nothingtoseehere.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder(["tryitandsee", "tias"], EarlyReplyMode.none)
                .set_description("Try it and see")
                .set_handler(this.tryitandsee.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("headbang", EarlyReplyMode.none)
                .set_description("Headbang")
                .set_handler(this.headbang.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("initgif", EarlyReplyMode.none)
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
            files: ["http://mikelui.io/img/c++_init_forest.gif"],
        });
    }
}
