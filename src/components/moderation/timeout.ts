import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { M, critical_error, unwrap } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
    moderation_type,
    parse_duration,
    reply_with_error,
} from "./moderation-common.js";
import Modlogs from "./modlogs.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { DAY } from "../../common.js";

/**
 * Implements !timeout
 */
export default class Timeout extends ModerationComponent {
    get type(): moderation_type {
        return "timeout";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("timeout")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!timeout")
                .add_subcommand(
                    new TextBasedCommandBuilder("add")
                        .set_description("!timeout add <user> <duration> <reason>")
                        .add_user_option({
                            title: "user",
                            description: "User to timeout (max 28 days)",
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
                        .set_handler(this.timeout_add_handler.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove")
                        .set_description("!timeout remove <user> <duration> <reason>")
                        .add_user_option({
                            title: "user",
                            description: "User to remove from timeout",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: true,
                        })
                        .set_handler(this.timeout_remove_handler.bind(this)),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying timeout to ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.timeout(unwrap(entry.duration), entry.reason ?? "No reason provided");
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing timeout from ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.timeout(null);
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.TCCPP.members.fetch(moderation.user);
        return member.communicationDisabledUntil !== null;
    }

    async timeout_add_handler(command: TextBasedCommand, user: Discord.User, duration: string, reason: string) {
        try {
            if (this.wheatley.is_authorized_mod(user)) {
                await reply_with_error(command, "Cannot apply moderation to user");
                return;
            }
            const base_moderation: basic_moderation_with_user = { type: "timeout", user: user.id };
            if (await this.is_moderation_applied(base_moderation)) {
                await reply_with_error(command, "User is already timed-out");
                return;
            }
            const duration_ms = parse_duration(duration);
            if (duration_ms == null || duration_ms > 28 * DAY) {
                await reply_with_error(command, "Maximum allowable duration is 28 days");
                return;
            }
            const moderation: moderation_entry = {
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                type: "timeout",
                reason,
                issued_at: Date.now(),
                duration: duration_ms,
                active: true,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.register_new_moderation(moderation);
            await this.reply_and_notify(command, user, "timed-out", moderation);
        } catch (e) {
            await reply_with_error(command, "Error applying timeout");
            critical_error(e);
        }
    }

    async timeout_remove_handler(command: TextBasedCommand, user: Discord.User, reason: string) {
        try {
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: "timeout", active: true },
                {
                    $set: {
                        active: false,
                        removed: {
                            moderator: command.user.id,
                            moderator_name: (await command.get_member()).displayName,
                            reason: reason,
                            timestamp: Date.now(),
                        },
                    },
                },
                {
                    returnDocument: "after",
                },
            );
            if (!res.value || !(await this.is_moderation_applied(res.value))) {
                await reply_with_error(command, "User is not timed-out");
            } else {
                await this.remove_moderation(res.value);
                this.sleep_list.remove(res.value._id);
                await this.reply_and_notify(command, user, "removed from timeout", res.value, true);
                await this.wheatley.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res.value,
                            await this.wheatley.client.users.fetch(res.value.user),
                        ).setTitle(`Removed from timeout`),
                    ],
                });
            }
        } catch (e) {
            await reply_with_error(command, "Error removing from timeout");
            critical_error(e);
        }
    }
}
