import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import { ModerationComponent, duration_regex } from "./moderation-common.js";
import { CommandSetBuilder } from "../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class Mute extends ModerationComponent {
    get type() {
        return "mute" as const;
    }

    get past_participle() {
        return "muted";
    }

    override get persist_moderation() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("mute", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Mute user")
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
                    (command: TextBasedCommand, user: Discord.User, duration: string | null, reason: string | null) =>
                        this.moderation_issue_handler(command, user, duration, reason, { type: this.type }),
                ),
        );

        commands.add(
            new TextBasedCommandBuilder("unmute", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Unmute user")
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
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying mute to ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.add(this.wheatley.roles.muted);
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing mute from ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.remove(this.wheatley.roles.muted);
        }
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_guild_member(moderation.user);
        if (member) {
            return member.roles.cache.filter(role => role.id == this.wheatley.roles.muted.id).size > 0;
        } else {
            // if the member isn't in the guild then lookup
            const res = await this.database.moderations.findOne({
                user: moderation.user,
                type: this.type,
                active: true,
            });
            return res !== null;
        }
    }
}
