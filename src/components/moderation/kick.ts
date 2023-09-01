import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { M, critical_error } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import {
    ModerationComponent,
    basic_moderation_with_user,
    moderation_entry,
    moderation_type,
    reply_with_error,
    reply_with_success_action,
} from "./moderation-common.js";

/**
 * Implements !kick
 */
export default class Kick extends ModerationComponent {
    get type(): moderation_type {
        return "kick";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("kick")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("!kick <user> <reason>")
                .add_user_option({
                    title: "user",
                    description: "User to kick",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: false,
                })
                .set_handler(this.kick_handler.bind(this)),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Kicking ${entry.user_name}`);
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.kick(entry.reason ?? undefined);
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        void entry;
        assert(false);
    }

    is_moderation_applied(moderation: basic_moderation_with_user): never {
        void moderation;
        assert(false);
    }

    async kick_handler(command: TextBasedCommand, user: Discord.User, reason: string | null) {
        try {
            if (this.wheatley.is_authorized_mod(user)) {
                await reply_with_error(command, "Cannot apply moderation to user");
                return;
            }
            const moderation: moderation_entry = {
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                type: "kick",
                reason,
                issued_at: Date.now(),
                duration: null,
                active: false,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.notify_user(command, user, "kicked", moderation);
            await this.register_new_moderation(moderation);
            await reply_with_success_action(command, user, "kicked", false, reason === null, moderation.case_number);
        } catch (e) {
            await reply_with_error(command, "Error kicking");
            critical_error(e);
        }
    }
}
