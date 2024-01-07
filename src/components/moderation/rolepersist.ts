import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { capitalize } from "../../utils/strings.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    duration_regex,
    moderation_entry,
} from "./moderation-common.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";

/**
 * Implements !rolepersist
 */
export default class Rolepersist extends ModerationComponent {
    get type() {
        return "rolepersist" as const;
    }

    get past_participle() {
        return "rolepersisted";
    }

    override get persist_moderation() {
        return true;
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
                        .set_handler(
                            (
                                command: TextBasedCommand,
                                user: Discord.User,
                                role: Discord.Role,
                                duration: string | null,
                                reason: string | null,
                            ) =>
                                this.moderation_issue_handler(command, user, duration, reason, {
                                    type: this.type,
                                    role: role.id,
                                    role_name: role.name,
                                }),
                        ),
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
                        .set_handler(
                            (command: TextBasedCommand, user: Discord.User, role: Discord.Role, reason: string) =>
                                this.moderation_revoke_handler(command, user, reason, { role: role.id }),
                        ),
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
                        ) =>
                            await this.moderation_issue_handler(command, user, duration, reason, {
                                type: this.type,
                                role: this.wheatley.roles[role].id,
                                role_name: this.wheatley.roles[role].name,
                            }),
                    ),
            );
        }
    }

    async apply_moderation(entry: moderation_entry) {
        assert(entry.type == this.type);
        M.info(`Applying rolepersist to ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
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
            // if the member isn't in the guild then let's call the moderation applied
            return true;
        }
    }
}
