import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { ModerationComponent } from "./moderation-common.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class VoiceNote extends ModerationComponent {
    get type() {
        return "voice_note" as const;
    }

    get past_participle() {
        return "voice noted";
    }

    override get is_once_off() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);

        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("note", EarlyReplyMode.ephemeral)
                        .set_description("Add a voice note")
                        .add_user_option({
                            title: "user",
                            description: "User to add note for",
                            required: true,
                        })
                        .add_string_option({
                            title: "note",
                            description: "Note content",
                            required: true,
                        })
                        .set_handler((command: TextBasedCommand, user: Discord.User, note: string | null) =>
                            this.moderation_issue_handler(command, user, null, note, { type: this.type }),
                        ),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        void entry;
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        void entry;
        assert(false);
    }

    is_moderation_applied_in_discord(moderation: basic_moderation_with_user): never {
        void moderation;
        assert(false);
    }
}
