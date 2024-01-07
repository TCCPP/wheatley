import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
} from "./moderation-common.js";
import { MINUTE } from "../../common.js";
import { unwrap } from "../../utils/misc.js";

/**
 * Implements !ban
 */
export default class Ban extends ModerationComponent {
    get type() {
        return "ban" as const;
    }

    get past_participle() {
        return "banned";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("ban")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Ban user")
                .add_user_option({
                    title: "user",
                    description: "User to ban",
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

        this.add_command(
            new TextBasedCommandBuilder("massban")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Ban users")
                .set_slash(false)
                .add_users_option({
                    title: "users",
                    description: "Users to ban",
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
                        users: Discord.User[],
                        duration: string | null,
                        reason: string | null,
                    ) => this.moderation_multi_issue_handler(command, users, duration, reason, { type: this.type }),
                ),
        );

        this.add_command(
            new TextBasedCommandBuilder("unban")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Unban user")
                .add_user_option({
                    title: "user",
                    description: "User to unban",
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
        M.info(`Banning ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        await this.wheatley.TCCPP.members.ban(entry.user, {
            reason: entry.reason ?? undefined,
        });
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Unbanning ${entry.user_name}`);
        await this.wheatley.TCCPP.members.unban(
            entry.user,
            entry.removed?.reason ?? entry.expunged?.reason ?? undefined,
        );
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        try {
            await this.wheatley.TCCPP.bans.fetch(moderation.user);
            return true;
        } catch (e) {
            return false;
        }
    }

    override async on_guild_member_remove(member: Discord.GuildMember | Discord.PartialGuildMember) {
        const logs = await member.guild.fetchAuditLogs({
            limit: 10,
            type: Discord.AuditLogEvent.MemberBanAdd,
        });
        const entry = logs.entries
            .filter(entry => entry.createdAt > new Date(Date.now() - 10 * MINUTE))
            .find(entry => unwrap(entry.target).id == member.user.id);
        if (entry && entry.executorId != this.wheatley.id) {
            const moderation: moderation_entry = {
                case_number: -1,
                user: unwrap(entry.target).id,
                user_name: unwrap(entry.target).displayName,
                moderator: unwrap(entry.executor).id,
                moderator_name: unwrap(entry.executor).displayName,
                type: "ban",
                reason: entry.reason,
                issued_at: Date.now(),
                duration: null,
                active: true,
                removed: null,
                expunged: null,
                link: null,
            };
            await this.issue_moderation(moderation);
        }
    }
}
