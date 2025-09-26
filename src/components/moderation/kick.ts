import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { EarlyReplyMode, TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import { ModerationComponent } from "./moderation-common.js";
import { CommandSetBuilder } from "../../command-abstractions/command-set-builder.js";
import { unwrap } from "../../utils/misc.js";
import { MINUTE } from "../../common.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class Kick extends ModerationComponent {
    get type() {
        return "kick" as const;
    }

    override get is_once_off() {
        return true;
    }

    get past_participle() {
        return "kicked";
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);
        commands.add(
            new TextBasedCommandBuilder("kick", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Kick user")
                .add_user_option({
                    title: "user",
                    description: "User to kick",
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
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Kicking ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        await this.wheatley.guild.members.kick(entry.user, entry.reason ?? undefined);
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        void entry;
        assert(false);
    }

    is_moderation_applied(moderation: basic_moderation_with_user): never {
        void moderation;
        assert(false);
    }

    override async on_guild_member_remove(member: Discord.GuildMember | Discord.PartialGuildMember) {
        const logs = await member.guild.fetchAuditLogs({
            limit: 10,
            type: Discord.AuditLogEvent.MemberKick,
        });
        const entry = logs.entries
            .filter(entry => entry.createdAt > new Date(Date.now() - 10 * MINUTE))
            .find(entry => unwrap(entry.target).id == member.user.id);
        if (entry && entry.executorId != this.wheatley.user.id) {
            const moderation: moderation_entry = {
                case_number: -1,
                user: unwrap(entry.target).id,
                user_name: unwrap(entry.target).displayName,
                moderator: unwrap(entry.executor).id,
                moderator_name: unwrap(entry.executor).displayName,
                type: "kick",
                reason: entry.reason,
                issued_at: Date.now(),
                duration: null,
                active: false,
                removed: null,
                expunged: null,
                link: null,
            };
            await this.issue_moderation(moderation);
        }
    }
}
