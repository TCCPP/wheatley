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
    parse_duration,
    reply_with_error,
} from "./moderation-common.js";

import * as mongo from "mongodb";

/**
 * Implements !rolepersist
 */
export default class Rolepersist extends ModerationComponent {
    get type(): "rolepersist" {
        return "rolepersist";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("rolepersist")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!rolepersist")
                .add_subcommand(
                    new TextBasedCommandBuilder("add")
                        .set_description("!rolepersist add <user> <role> <duration> <reason>")
                        .add_user_option({
                            title: "user",
                            description: "User to rolepersist",
                            required: true,
                        })
                        .add_string_option({
                            title: "role",
                            description: "Role",
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
                        .set_handler(this.rolepersist_add.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove")
                        .set_description("!rolepersist remove <user> <role> <reason>")
                        .add_user_option({
                            title: "user",
                            description: "User to rolepersist",
                            required: true,
                        })
                        .add_string_option({
                            title: "role",
                            description: "Role",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: true,
                        })
                        .set_handler(this.rolepersist_remove.bind(this)),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        assert(entry.type == this.type);
        M.info(`Applying rolepersist to ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.add(entry.role);
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        assert(entry.type == this.type);
        M.info(`Removing rolepersist from ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.roles.remove(entry.role);
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.TCCPP.members.fetch(moderation.user);
        return member.roles.cache.filter(role => role.id == moderation.role).size > 0;
    }

    async rolepersist_add(
        command: TextBasedCommand,
        user: Discord.User,
        role_name: string,
        duration: string,
        reason: string,
    ) {
        try {
            const role = this.wheatley.get_role_by_name(role_name).id;
            const base_moderation: basic_moderation_with_user = { type: "rolepersist", user: user.id, role };
            if (await this.is_moderation_applied(base_moderation)) {
                await reply_with_error(command, "User is already role-persisted with this role");
                return;
            }
            const moderation: moderation_entry = {
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                type: "rolepersist",
                role,
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: true,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.register_new_moderation(moderation);
            await this.reply_and_notify(command, user, "role-persisted", moderation);
        } catch (e) {
            await reply_with_error(command, "Error applying role-persist");
            critical_error(e);
        }
    }

    async rolepersist_remove(command: TextBasedCommand, user: Discord.User, role_name: string, reason: string) {
        try {
            const role = this.wheatley.get_role_by_name(role_name).id;
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: "rolepersist", role, active: true },
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
                await reply_with_error(command, "User is not role-persisted with that role");
            } else {
                await this.remove_moderation(res.value);
                this.sleep_list.remove(res.value._id);
                await this.reply_and_notify(command, user, "removed from role-persist", res.value, true);
            }
        } catch (e) {
            await reply_with_error(command, "Error removing role-persist");
            critical_error(e);
        }
    }
}
