import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { time_to_human } from "../../utils/strings.js";
import { M } from "../../utils/debugging-and-logging.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { ModerationComponent, parse_duration } from "./moderation-common.js";
import { colors } from "../../common.js";
import Modlogs from "./modlogs.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";

export default class ModerationControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("reason")
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

        this.add_command(
            new TextBasedCommandBuilder("context")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Update case context")
                .add_subcommand(
                    new TextBasedCommandBuilder("add")
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

        this.add_command(
            new TextBasedCommandBuilder("duration")
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

        this.add_command(
            new TextBasedCommandBuilder("expunge")
                .set_description("Expunge a case")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
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

    // returns true if unable to dm user
    async notify_user(command: TextBasedCommand, user: string, case_number: number, message: string) {
        try {
            await (
                await (await this.wheatley.client.users.fetch(user)).createDM()
            ).send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle(`Case ${case_number} updated`)
                        .setDescription(message),
                ],
            });
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 50007) {
                // 50007: Cannot send messages to this user
                return true;
            } else {
                await this.reply_with_error(command, "Error notifying");
            }
        }
        return false;
    }

    async reason(command: TextBasedCommand, case_number: number, reason: string) {
        const res = await this.wheatley.database.moderations.findOneAndUpdate(
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
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                        `Case ${res.case_number} reason updated`,
                    ),
                ],
            });
            await this.notify_user(command, res.user, case_number, `**Reason:** ${reason}`);
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async context_add(command: TextBasedCommand, case_number: number, context: string) {
        const res = await this.wheatley.database.moderations.findOneAndUpdate(
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
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                        `Case ${res.case_number} context updated`,
                    ),
                ],
            });
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async duration(command: TextBasedCommand, case_number: number, duration: string) {
        const item = await this.wheatley.database.moderations.findOne({ case_number });
        if (!item) {
            await this.reply_with_error(command, `Case ${case_number} not found`);
            return;
        }
        if (ModerationComponent.non_duration_moderation_set.has(item.type)) {
            await this.reply_with_error(command, `Case ${case_number} can't take a duration`);
            return;
        }
        const res = await this.wheatley.database.moderations.findOneAndUpdate(
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
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                        `Case ${res.case_number} duration updated`,
                    ),
                ],
            });
            const duration_str = res.duration ? time_to_human(res.duration) : "Permanent";
            await this.notify_user(command, res.user, case_number, `**Duration:** ${duration_str}`);
        }
    }

    async expunge(command: TextBasedCommand, case_number: number, reason: string | null) {
        const res = await this.wheatley.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $set: {
                    active: false, // moderation update handler will handle the removal if necessary
                    expunged: {
                        moderator: command.user.id,
                        moderator_name: (await command.get_member()).displayName,
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
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                        `Case ${res.case_number} expunged`,
                    ),
                ],
            });
            await this.notify_user(command, res.user, case_number, `**Expunged:** ${reason ?? "No reason provided"}`);
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    // TODO: Code duplication
    async reply_with_error(command: TextBasedCommand, message: string) {
        await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.error} ***${message}***`),
            ],
        });
    }

    async reply_with_success(command: TextBasedCommand, message: string) {
        await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.green)
                    .setDescription(`${this.wheatley.success} ***${message}***`),
            ],
        });
    }
}
