import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { M } from "../../../../utils/debugging-and-logging.js";
import { ModerationComponent } from "./moderation-common.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class VoiceMute extends ModerationComponent {
    get type() {
        return "voice_mute" as const;
    }

    get past_participle() {
        return "voice muted";
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);

        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("mute", EarlyReplyMode.ephemeral)
                        .set_description("Server mute a user")
                        .add_user_option({
                            title: "user",
                            description: "User to mute",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler((command: TextBasedCommand, user: Discord.User, reason: string | null) =>
                            this.moderation_issue_handler(command, user, null, reason, { type: this.type }),
                        ),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("unmute", EarlyReplyMode.ephemeral)
                        .set_description("Server unmute a user")
                        .add_user_option({
                            title: "user",
                            description: "User to unmute",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(this.moderation_revoke_handler.bind(this)),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying voice mute to ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member?.voice.channel) {
            await member.voice.setMute(true);
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing voice mute from ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member?.voice.channel) {
            await member.voice.setMute(false);
        }
    }

    async is_moderation_applied_in_discord(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_guild_member(moderation.user);
        return member?.voice.serverMute ?? false;
    }
}
