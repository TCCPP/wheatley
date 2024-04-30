import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { critical_error } from "../../utils/debugging-and-logging.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import { ModerationComponent } from "./moderation-common.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation } from "../../infra/schemata/moderation.js";

export default class Warn extends ModerationComponent {
    get type() {
        return "warn" as const;
    }

    get past_participle() {
        return "warned";
    }

    override get is_once_off() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("warn")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Warn user")
                .add_user_option({
                    title: "user",
                    description: "User to warn",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler((command: TextBasedCommand, user: Discord.User, reason: string | null) =>
                    this.moderation_issue_handler(command, user, null, reason, { type: this.type }),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        // nop
        void entry;
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        void entry;
        assert(false);
    }

    is_moderation_applied(moderation: basic_moderation): never {
        void moderation;
        assert(false);
    }
}
