import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, critical_error, unwrap } from "../../utils.js";
import { Wheatley } from "../../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";
import { ModerationComponent, basic_moderation, moderation_entry, moderation_type } from "./moderation-common.js";

import * as mongo from "mongodb";

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
            new TextBasedCommandBuilder("wkick")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("wkick")
                .add_user_option({
                    title: "user",
                    description: "User to kick",
                    required: true,
                })
                .add_string_option({
                    title: "reason",
                    description: "Reason",
                    required: true,
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
        assert(false);
    }

    is_moderation_applied(moderation: basic_moderation): never {
        assert(false);
    }

    async kick_handler(command: TextBasedCommand, user: Discord.User, reason: string) {
        try {
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
            };
            await this.register_new_moderation(moderation);
            await this.notify(command, user, "kicked", moderation);
        } catch (e) {
            await this.reply_with_error(command, "Error kicking");
            critical_error(e);
        }
    }
}
