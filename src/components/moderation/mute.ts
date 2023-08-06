import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../utils.js";
import { colors } from "../../common.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";

/**
 * Implements !mute
 */
export default class Mute extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("wmute")
                .set_description("wmute")
                .add_user_option({
                    title: "user",
                    description: "User to mute",
                    required: true,
                })
                .add_string_option({
                    title: "duration",
                    description: "Duration",
                    regex: /(?:perm\b|\d+\s*[mhdwMy])/,
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.handler.bind(this)),
        );
    }

    async handler(command: TextBasedCommand, user: Discord.User, time: string, reason: string) {
        await command.reply(JSON.stringify([user.displayName, time, reason]));
    }
}
