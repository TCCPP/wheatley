import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { capitalize } from "../../../../utils/strings.js";
import { M } from "../../../../utils/debugging-and-logging.js";
import { Wheatley } from "../../../../wheatley.js";
import { ModerationComponent, duration_regex } from "./moderation-common.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

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

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);

        commands.add(
            new TextBasedCommandBuilder("rolepersist", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
                .set_description("Rolepersist add/remove")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.visible)
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
                    new TextBasedCommandBuilder("remove", EarlyReplyMode.visible)
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
                            required: false,
                        })
                        .set_handler(
                            (
                                command: TextBasedCommand,
                                user: Discord.User,
                                role: Discord.Role,
                                reason: string | null,
                            ) => this.moderation_revoke_handler(command, user, reason, { role: role.id }),
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
            novoice: "no_voice",
        };

        for (const [command, role] of Object.entries(aliases)) {
            commands.add(
                new TextBasedCommandBuilder(command, EarlyReplyMode.visible)
                    .set_category("Moderation")
                    .set_alias_of("rolepersist add")
                    .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
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
        // for a role that no longer exists
        if (entry.role === "") {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            try {
                await member.roles.add(entry.role);
            } catch (e) {
                if (e instanceof Discord.DiscordAPIError && e.code === 10011) {
                    return; // Unknown Role - nop
                } else {
                    throw e;
                }
            }
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        assert(entry.type == this.type);
        M.info(`Removing rolepersist from ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        // for a role that no longer exists
        if (entry.role === "") {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            try {
                await member.roles.remove(entry.role);
            } catch (e) {
                if (e instanceof Discord.DiscordAPIError && e.code === 10011) {
                    return; // Unknown Role - nop
                } else {
                    throw e;
                }
            }
        }
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_guild_member(moderation.user);
        // for a role that no longer exists
        if (moderation.role === "") {
            return false;
        }
        if (member) {
            return member.roles.cache.filter(role => role.id == moderation.role).size > 0;
        } else {
            // if the member isn't in the guild then let's call the moderation applied
            return true;
        }
    }
}
