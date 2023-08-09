import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, critical_error, unwrap } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";
import {
    ModerationComponent,
    basic_moderation,
    duration_regex,
    moderation_entry,
    moderation_type,
    parse_duration,
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
            new TextBasedCommandBuilder("wmute")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("wmute")
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
            new TextBasedCommandBuilder("wunmute")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("wunmute")
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

    async apply_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Applying mute to ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.add(this.wheatley.muted_role);
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing mute from ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.remove(this.wheatley.muted_role);
        this.sleep_list.remove(entry._id);
    }

    async is_moderation_applied(moderation: basic_moderation) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.TCCPP.members.fetch(moderation.user);
        return member.roles.cache.filter(role => role.id == this.wheatley.muted_role.id).size > 0;
    }

    async mute_handler(command: TextBasedCommand, user: Discord.User, duration: string, reason: string) {
        try {
            const base_moderation: basic_moderation = { type: "mute", user: user.id };
            if (await this.is_moderation_applied(base_moderation)) {
                await this.reply_with_error(command, "User is already muted");
            }
            await this.wheatley.database.lock();
            const document: moderation_entry = {
                case_number: await this.get_case_id(),
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
            };
            const res = await this.wheatley.database.moderations.insertOne(document);
            await this.add_new_moderation({
                _id: res.insertedId,
                ...document,
            });
            await this.notify(command, user, "muted", document);
        } catch (e) {
            await this.reply_with_error(command, "Error applying mute");
            critical_error(e);
        } finally {
            this.wheatley.database.unlock();
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
            );
            if (!res.value || !(await this.is_moderation_applied(res.value))) {
                await this.reply_with_error(command, "User is not muted");
            } else {
                await this.remove_moderation(res.value);
                await this.notify(command, user, "unmuted", res.value, false);
            }
        } catch (e) {
            await this.reply_with_error(command, "Error unmuting");
            critical_error(e);
        }
    }
}
