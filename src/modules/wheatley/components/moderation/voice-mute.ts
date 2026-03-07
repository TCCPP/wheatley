import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { M } from "../../../../utils/debugging-and-logging.js";
import { ModerationComponent, duration_regex } from "./moderation-common.js";
import { role_map } from "../../../../role-map.js";
import { wheatley_roles } from "../../roles.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class VoiceMute extends ModerationComponent {
    private roles = role_map(this.wheatley, wheatley_roles.voice_muted);

    get type() {
        return "voice_mute" as const;
    }

    get past_participle() {
        return "voice muted";
    }

    override get persist_moderation() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);
        this.roles.resolve();

        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("mute", EarlyReplyMode.ephemeral)
                        .set_description("Voice mute a user")
                        .add_user_option({
                            title: "user",
                            description: "User to mute",
                            required: true,
                        })
                        .add_string_option({
                            title: "duration",
                            description: "Duration",
                            regex: duration_regex,
                            required: false,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(
                            (
                                command: TextBasedCommand,
                                user: Discord.User,
                                duration: string | null,
                                reason: string | null,
                            ) => this.moderation_issue_handler(command, user, duration, reason, { type: this.type }),
                        ),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("unmute", EarlyReplyMode.ephemeral)
                        .set_description("Voice unmute a user")
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
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.add(this.roles.voice_muted);
            if (member.voice.channel) {
                await this.wheatley.force_voice_permissions_update(member);
            }
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing voice mute from ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.remove(this.roles.voice_muted);
            if (member.voice.channel) {
                await this.wheatley.force_voice_permissions_update(member);
            }
        }
    }

    async is_moderation_applied_in_discord(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_guild_member(moderation.user);
        return member?.roles.cache.has(this.roles.voice_muted.id) ?? false;
    }
}
