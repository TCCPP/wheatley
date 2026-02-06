import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { time_to_human } from "../../../../utils/strings.js";
import { M } from "../../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../../bot-component.js";
import { Wheatley } from "../../../../wheatley.js";
import { ModerationComponent, parse_duration } from "./moderation-common.js";
import { moderation_entry, note_moderation_types, voice_moderation_types } from "./schemata.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import { colors } from "../../../../common.js";
import Modlogs, { staff_moderation_display_options, public_moderation_display_options } from "./modlogs.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { unwrap } from "../../../../utils/misc.js";
import Help from "../help.js";
import NotificationThreads from "../notification-threads.js";

export default class ModerationControl extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
    }>();
    private staff_action_log!: Discord.TextChannel;
    private public_action_log!: Discord.TextChannel;
    private rules!: Discord.TextChannel;
    private notification_threads!: NotificationThreads;

    override async setup(commands: CommandSetBuilder) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
        this.public_action_log = await this.utilities.get_channel(this.wheatley.channels.public_action_log);
        this.rules = await this.utilities.get_channel(this.wheatley.channels.rules);
        this.notification_threads = unwrap(this.wheatley.components.get("NotificationThreads")) as NotificationThreads;

        (this.wheatley.components.get("Help") as Help | undefined)?.add_category_content(
            "Moderation",
            "Durations: `perm` for permanent or `number unit` (whitespace ignored). Units are y, M, w, d, h, m, s.",
        );

        commands.add(
            new TextBasedCommandBuilder("reason", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_description("Update the reason for a case")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to update",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.reason.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("context", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Update case context")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.visible)
                        .set_description("Add context")
                        .add_number_option({
                            title: "case",
                            description: "Case to update",
                            required: true,
                        })
                        .add_string_option({
                            title: "context",
                            description: "Context",
                            required: true,
                        })
                        .set_handler(this.context_add.bind(this)),
                ),
        );

        commands.add(
            new TextBasedCommandBuilder("duration", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_description("Update the duration for a case")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to update",
                    required: true,
                })
                .add_string_option({
                    title: "duration",
                    description: "Duration",
                    required: true,
                })
                .set_handler(this.duration.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("expunge", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_description("Expunge a case")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to expunge",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: false,
                })
                .set_handler(this.expunge.bind(this)),
        );
    }

    async notify_user(user: string, case_number: number, description: string) {
        const discord_user = await this.wheatley.client.users.fetch(user);
        await this.notification_threads.notify_user_with_thread_fallback(
            this.rules,
            discord_user,
            {
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle(`Case ${case_number} updated`)
                        .setDescription(description),
                ],
            },
            "Moderation Notification",
        );
    }

    async reason(command: TextBasedCommand, case_number: number, reason: string) {
        const res = await this.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $set: {
                    reason,
                },
            },
            {
                returnDocument: "after",
            },
        );
        if (res) {
            await this.reply_with_success(command, "Reason updated");
            await this.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(
                        res,
                        await this.wheatley.client.users.fetch(res.user),
                        staff_moderation_display_options,
                    ).setTitle(`Case ${res.case_number} reason updated`),
                ],
            });
            if (!note_moderation_types.includes(res.type)) {
                await this.public_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res,
                            await this.wheatley.client.users.fetch(res.user),
                            public_moderation_display_options,
                        ).setTitle(`Case ${res.case_number} reason updated`),
                    ],
                });
                await this.notify_user(res.user, case_number, `**Reason:** ${reason}`);
            }
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async context_add(command: TextBasedCommand, case_number: number, context: string) {
        const res = await this.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $push: {
                    context,
                },
            },
            {
                returnDocument: "after",
            },
        );
        if (res) {
            await this.reply_with_success(command, "Context updated");
            await this.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(
                        res,
                        await this.wheatley.client.users.fetch(res.user),
                        staff_moderation_display_options,
                    ).setTitle(`Case ${res.case_number} context updated`),
                ],
            });
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async duration(command: TextBasedCommand, case_number: number, duration: string) {
        const item = await this.database.moderations.findOne({ case_number });
        if (!item) {
            await this.reply_with_error(command, `Case ${case_number} not found`);
            return;
        }
        if (ModerationComponent.non_duration_moderation_set.has(item.type)) {
            await this.reply_with_error(command, `Case ${case_number} can't take a duration`);
            return;
        }
        const res = await this.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $set: {
                    active: true, // just set to true, sleep list will handle
                    duration: parse_duration(duration),
                },
            },
            {
                returnDocument: "after",
            },
        );
        if (res) {
            await this.reply_with_success(command, "Duration updated");
            // Update sleep lists and remove moderation if needed
            this.wheatley.event_hub.emit("update_moderation", res);
            await this.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(
                        res,
                        await this.wheatley.client.users.fetch(res.user),
                        staff_moderation_display_options,
                    ).setTitle(`Case ${res.case_number} duration updated`),
                ],
            });
            if (!note_moderation_types.includes(res.type)) {
                await this.public_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res,
                            await this.wheatley.client.users.fetch(res.user),
                            public_moderation_display_options,
                        ).setTitle(`Case ${res.case_number} duration updated`),
                    ],
                });
                const duration_str = res.duration ? time_to_human(res.duration) : "Permanent";
                await this.notify_user(res.user, case_number, `**Duration:** ${duration_str}`);
            }
        }
    }

    async expunge(command: TextBasedCommand, case_number: number, reason: string | null) {
        const member = await command.get_member();
        const has_ban_members = member.permissions.has(Discord.PermissionFlagsBits.BanMembers);
        if (!has_ban_members) {
            const moderation = await this.database.moderations.findOne({ case_number });
            if (!moderation) {
                await this.reply_with_error(command, `Case ${case_number} not found`);
                return;
            }
            if (!voice_moderation_types.includes(moderation.type)) {
                await this.reply_with_error(command, "You can only expunge voice moderation cases");
                return;
            }
        }
        const res = await this.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $set: {
                    active: false, // moderation update handler will handle the removal if necessary
                    expunged: {
                        moderator: command.user.id,
                        moderator_name: member.displayName,
                        reason,
                        timestamp: Date.now(),
                    },
                },
            },
            {
                returnDocument: "after",
            },
        );
        if (res) {
            await this.reply_with_success(command, "Case expunged");
            // Update sleep lists and remove moderation if needed
            this.wheatley.event_hub.emit("update_moderation", res);
            await this.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(
                        res,
                        await this.wheatley.client.users.fetch(res.user),
                        staff_moderation_display_options,
                    ).setTitle(`Case ${res.case_number} expunged`),
                ],
            });
            if (!note_moderation_types.includes(res.type)) {
                await this.public_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res,
                            await this.wheatley.client.users.fetch(res.user),
                            public_moderation_display_options,
                        ).setTitle(`Case ${res.case_number} expunged`),
                    ],
                });
                await this.notify_user(res.user, case_number, `**Expunged:** ${reason ?? "No reason provided"}`);
            }
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    // TODO: Code duplication
    async reply_with_error(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.emoji.error} ***${message}***`),
            ],
        });
    }

    async reply_with_success(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.green)
                    .setDescription(`${this.wheatley.emoji.success} ***${message}***`),
            ],
        });
    }
}
