import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../utils.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";
import { ModerationComponent, parse_duration, reply_with_error, reply_with_success } from "./moderation-common.js";

/**
 * Implements !reason, !duration, ane !expunge
 */
export default class ModerationControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("wreason")
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
            new TextBasedCommandBuilder("wduration")
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
            new TextBasedCommandBuilder("wexpunge")
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
                    required: true,
                })
                .set_handler(this.expunge.bind(this)),
        );
    }

    // TODO: Deal with notifying users for all this

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
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async duration(command: TextBasedCommand, case_number: number, duration: string) {
        M.log("Received duration command");
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
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
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
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
        }
    }
}
