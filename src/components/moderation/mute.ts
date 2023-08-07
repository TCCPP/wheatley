import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, unwrap } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommandBuilder } from "../../command.js";
import { ModerationComponent, duration_regex, moderation_entry, moderation_type } from "./moderation-common.js";

import * as mongo from "mongodb";

/**
 * Implements !mute
 */
export default class Mute extends ModerationComponent {
    get type(): moderation_type {
        return "mute";
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
                    regex: duration_regex,
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.moderation_handler.bind(this)),
        );
    }

    async add_moderation(entry: mongo.WithId<moderation_entry>) {
        // TODO
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        // TODO
    }
}
