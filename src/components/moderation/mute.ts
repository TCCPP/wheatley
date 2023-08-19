import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, critical_error } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
    moderation_type,
    parse_duration,
    reply_with_error,
} from "./moderation-common.js";

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
            new TextBasedCommandBuilder("mute")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!mute <user> <duration> <reason>")
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
                .set_handler(this.mute_handler.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("unmute")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!unmute <user> <reason>")
                .add_user_option({
                    title: "user",
                    description: "User to unmute",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.unmute_handler.bind(this)),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying mute to ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.add(this.wheatley.roles.muted);
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing mute from ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.remove(this.wheatley.roles.muted);
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.TCCPP.members.fetch(moderation.user);
        return member.roles.cache.filter(role => role.id == this.wheatley.roles.muted.id).size > 0;
    }

    async mute_handler(command: TextBasedCommand, user: Discord.User, duration: string, reason: string) {
        try {
            const base_moderation: basic_moderation_with_user = { type: "mute", user: user.id };
            if (await this.is_moderation_applied(base_moderation)) {
                await reply_with_error(command, "User is already muted");
                return;
            }
            const moderation: moderation_entry = {
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                type: "mute",
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: true,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.register_new_moderation(moderation);
            await this.reply_and_notify(command, user, "muted", moderation);
        } catch (e) {
            await reply_with_error(command, "Error applying mute");
            critical_error(e);
        }
    }

    async unmute_handler(command: TextBasedCommand, user: Discord.User, reason: string) {
        try {
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: "mute", active: true },
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
                await reply_with_error(command, "User is not muted");
            } else {
                await this.remove_moderation(res.value);
                this.sleep_list.remove(res.value._id);
                await this.reply_and_notify(command, user, "unmuted", res.value, true);
            }
        } catch (e) {
            await reply_with_error(command, "Error unmuting");
            critical_error(e);
        }
    }
}
