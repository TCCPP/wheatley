import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, time_to_human } from "../../utils.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";
import { ModerationComponent, parse_duration, reply_with_error, reply_with_success } from "./moderation-common.js";
import { colors } from "../../common.js";
import Modlogs from "./modlogs.js";

/**
 * Implements !reason, !duration, ane !expunge
 */
export default class ModerationControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("reason")
                .set_description("Update the reason for a case. !reason <case> <reason>")
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
            new TextBasedCommandBuilder("duration")
                .set_description("Update the duration for a case. !duration <case> <duration>")
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
                .set_description("Expunge a case. !expunge <case> <reason>")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to expunge",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
                })
                .set_handler(this.expunge.bind(this)),
        );
    }

    async notify_user(user: string, case_number: number, message: string) {
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
    }

    async reason(command: TextBasedCommand, case_number: number, reason: string) {
        M.log("Received reason command");
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
        if (res.value) {
            await reply_with_success(command, "Reason updated");
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res.value, await this.wheatley.client.users.fetch(res.value.user)).setTitle(
                        `Case ${res.value.case_number} reason updated`,
                    ),
                ],
            });
            await this.notify_user(res.value.user, case_number, `**Reason:** ${reason}`);
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async duration(command: TextBasedCommand, case_number: number, duration: string) {
        M.log("Received duration command");
        const item = await this.wheatley.database.moderations.findOne({ case_number });
        if (!item) {
            await reply_with_error(command, `Case ${case_number} not found`);
            return;
        }
        if (ModerationComponent.non_duration_moderation_set.has(item.type)) {
            await reply_with_error(command, `Case ${case_number} can't take a duration`);
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
        if (res.value) {
            await reply_with_success(command, "Duration updated");
            // Update sleep lists and remove moderation if needed
            ModerationComponent.event_hub.emit("moderation_update", res.value);
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res.value, await this.wheatley.client.users.fetch(res.value.user)).setTitle(
                        `Case ${res.value.case_number} duration updated`,
                    ),
                ],
            });
            const duration_str = res.value.duration ? time_to_human(res.value.duration) : "Permanent";
            await this.notify_user(res.value.user, case_number, `**Duration:** ${duration_str}`);
        }
    }

    async expunge(command: TextBasedCommand, case_number: number, reason: string) {
        M.log("Received expunge command");
        const res = await this.wheatley.database.moderations.findOneAndUpdate(
            { case_number },
            {
                $set: {
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
        if (res.value) {
            await reply_with_success(command, "Case expunged");
            // Update sleep lists and remove moderation if needed
            ModerationComponent.event_hub.emit("moderation_update", res.value);
            await this.wheatley.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(res.value, await this.wheatley.client.users.fetch(res.value.user)).setTitle(
                        `Case ${res.value.case_number} expunged`,
                    ),
                ],
            });
            await this.notify_user(res.value.user, case_number, `**Expunged:** ${reason}`);
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
        }
    }
}
