import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { capitalize } from "../../utils/strings.js";
import { critical_error } from "../../utils/debugging-and-logging.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
    parse_duration,
    reply_with_error,
    moderation_on_team_member_message,
} from "./moderation-common.js";
import Modlogs from "./modlogs.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";

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
                .set_description("Rolepersist add/remove")
                .add_subcommand(
                    new TextBasedCommandBuilder("add")
                        .set_description("Rolepersist user")
                        .add_user_option({
                            title: "user",
                            description: "User to rolepersist",
                            required: true,
                        })
                        .add_role_option({
                            title: "role",
                            description: "Role",
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
                        .set_handler(this.rolepersist_add.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove")
                        .set_description("Rolepersist remove user")
                        .add_user_option({
                            title: "user",
                            description: "User to rolepersist",
                            required: true,
                        })
                        .add_role_option({
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

        const aliases: Record<string, keyof Wheatley["roles"]> = {
            noofftopic: "no_off_topic",
            nosuggestions: "no_suggestions",
            nosuggestionsatall: "no_suggestions_at_all",
            noreactions: "no_reactions",
            nothreads: "no_threads",
            noseriousofftopic: "no_serious_off_topic",
            notil: "no_til",
            nomemes: "no_memes",
        };

        for (const [command, role] of Object.entries(aliases)) {
            this.add_command(
                new TextBasedCommandBuilder(command)
                    .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                    .set_description(`${capitalize(role).replace("_", " ")}`)
                    .add_user_option({
                        title: "user",
                        description: "User to rolepersist",
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
                        async (
                            command: TextBasedCommand,
                            user: Discord.User,
                            duration: string | null,
                            reason: string | null,
                        ) => await this.rolepersist_add(command, user, this.wheatley.roles[role], duration, reason),
                    ),
            );
        }
    }

    async apply_moderation(entry: moderation_entry) {
        assert(entry.type == this.type);
        M.info(`Applying rolepersist to ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_member(entry.user);
        if (member) {
            await member.roles.add(entry.role);
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        assert(entry.type == this.type);
        M.info(`Removing rolepersist from ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_member(entry.user);
        if (member) {
            await member.roles.remove(entry.role);
        }
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_member(moderation.user);
        if (member) {
            return member.roles.cache.filter(role => role.id == moderation.role).size > 0;
        } else {
            return false;
        }
    }

    async rolepersist_add(
        command: TextBasedCommand,
        user: Discord.User,
        role: Discord.Role,
        duration: string | null,
        reason: string | null,
    ) {
        try {
            if (this.wheatley.is_authorized_mod(user)) {
                await reply_with_error(command, moderation_on_team_member_message);
                return;
            }
            const base_moderation: basic_moderation_with_user = {
                type: "rolepersist",
                user: user.id,
                role: role.id,
                role_name: role.name,
            };
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
                role: role.id,
                role_name: role.name,
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: true,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.register_new_moderation(moderation);
            await this.reply_and_notify(
                command,
                user,
                "role-persisted",
                moderation,
                duration === null,
                reason === null,
            );
        } catch (e) {
            await reply_with_error(command, "Error applying role-persist");
            critical_error(e);
        }
    }

    async rolepersist_remove(command: TextBasedCommand, user: Discord.User, role: Discord.Role, reason: string) {
        try {
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: "rolepersist", role: role.id, active: true },
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
            if (!res || !(await this.is_moderation_applied(res))) {
                await reply_with_error(command, "User is not role-persisted with that role");
            } else {
                await this.remove_moderation(res);
                this.sleep_list.remove(res._id);
                await this.reply_and_notify(command, user, "removed from role-persist", res, false, false, true);
                await this.wheatley.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                            `Case ${res.case_number}: Rolepersist Removed`,
                        ),
                    ],
                });
            }
        } catch (e) {
            await reply_with_error(command, "Error removing role-persist");
            critical_error(e);
        }
    }
}
