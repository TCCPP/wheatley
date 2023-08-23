import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { M, critical_error } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
    moderation_type,
    parse_duration,
    reply_with_error,
    reply_with_success_action,
} from "./moderation-common.js";
import Modlogs from "./modlogs.js";

/**
 * Implements !ban
 */
export default class Ban extends ModerationComponent {
    get type(): moderation_type {
        return "ban";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("ban")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!ban <user> <duration> <reason>")
                .add_user_option({
                    title: "user",
                    description: "User to ban",
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
                .set_handler(this.ban_handler.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("unban")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!unban <user> <reason>")
                .add_user_option({
                    title: "user",
                    description: "User to unban",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.unban_handler.bind(this)),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Banning ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.ban({
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

    async ban_handler(command: TextBasedCommand, user: Discord.User, duration: string, reason: string) {
        try {
            if (this.wheatley.is_authorized_mod(user)) {
                await reply_with_error(command, "Cannot apply moderation to user");
                return;
            }
            const base_moderation: basic_moderation_with_user = { type: "ban", user: user.id };
            if (await this.is_moderation_applied(base_moderation)) {
                await reply_with_error(command, "User is already banned");
                return;
            }
            const moderation: moderation_entry = {
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                type: "ban",
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: true,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.notify_user(command, user, "banned", moderation);
            await this.register_new_moderation(moderation);
            await reply_with_success_action(command, user, "banned", moderation.case_number);
        } catch (e) {
            await reply_with_error(command, "Error banning");
            critical_error(e);
        }
    }

    async unban_handler(command: TextBasedCommand, user: Discord.User, reason: string) {
        try {
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: "ban", active: true },
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
                await reply_with_error(command, "User is not banned");
            } else {
                await this.remove_moderation(res.value);
                this.sleep_list.remove(res.value._id);
                await reply_with_success_action(command, user, "unbanned");
                await this.wheatley.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res.value,
                            await this.wheatley.client.users.fetch(res.value.user),
                        ).setTitle(`Unbanned`),
                    ],
                });
            }
        } catch (e) {
            await reply_with_error(command, "Error unbanning");
            critical_error(e);
        }
    }
}
