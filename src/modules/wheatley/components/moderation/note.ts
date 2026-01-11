import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { Wheatley } from "../../../../wheatley.js";
import { ModerationComponent } from "./moderation-common.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation } from "./schemata.js";
import { colors } from "../../../../common.js";
import { build_description } from "../../../../utils/strings.js";

export default class Note extends ModerationComponent {
    get type() {
        return "note" as const;
    }

    get past_participle() {
        return "noted";
    }

    override get is_once_off() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);

        commands.add(
            new TextBasedCommandBuilder("note", EarlyReplyMode.ephemeral)
                .set_category("Moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .set_description("Enter note in modlogs")
                .add_user_option({
                    title: "user",
                    description: "User to enter note on",
                    required: true,
                })
                .add_string_option({
                    title: "note",
                    description: "Note",
                    required: true,
                })
                .set_handler((command: TextBasedCommand, user: Discord.User, note: string | null) =>
                    this.moderation_issue_handler(command, user, null, note, { type: this.type }),
                ),
        );
    }

    override async moderation_issue_handler(
        command: TextBasedCommand,
        user: Discord.User,
        duration: string | null,
        reason: string | null,
        basic_moderation_info: basic_moderation,
    ) {
        try {
            const moderation: moderation_entry = {
                ...basic_moderation_info,
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                reason,
                issued_at: Date.now(),
                duration: null,
                active: false,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            await this.issue_moderation(moderation);
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(
                            build_description(
                                `${this.wheatley.emoji.success} ***Note added for ${user.displayName}***`,
                                command.is_slash() && reason ? `**Reason:** ${reason}` : null,
                            ),
                        )
                        .setFooter({
                            text: `Case ${moderation.case_number}`,
                        }),
                ],
                ephemeral_if_possible: true,
            });
        } catch (e) {
            await this.reply_with_error(command, `Error issuing ${this.type}`);
            this.wheatley.critical_error(e);
        }
    }

    async apply_moderation(entry: moderation_entry) {
        // nop
        void entry;
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        void entry;
        assert(false);
    }

    is_moderation_applied(moderation: basic_moderation): never {
        void moderation;
        assert(false);
    }
}
