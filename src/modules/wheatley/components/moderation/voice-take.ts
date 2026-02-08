import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { M } from "../../../../utils/debugging-and-logging.js";
import { ModerationComponent } from "./moderation-common.js";
import { role_map } from "../../../../role-map.js";
import { wheatley_roles } from "../../roles.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { moderation_entry, basic_moderation_with_user } from "./schemata.js";

export default class VoiceTake extends ModerationComponent {
    private roles = role_map(this.wheatley, wheatley_roles.voice);

    get type() {
        return "voice_take" as const;
    }

    get past_participle() {
        return "devoiced";
    }

    override get persist_moderation() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        await super.setup(commands);
        this.roles.resolve();

        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("take", EarlyReplyMode.ephemeral)
                        .set_description("Take voice from a user")
                        .add_user_option({
                            title: "user",
                            description: "User to lose voice",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(this.handle_take.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("give", EarlyReplyMode.ephemeral)
                        .set_description("Give voice to a user")
                        .add_user_option({
                            title: "user",
                            description: "User to receive voice",
                            required: true,
                        })
                        .set_handler(this.handle_give.bind(this)),
                ),
        );
    }

    private async handle_take(command: TextBasedCommand, user: Discord.User, reason: string | null) {
        const target = await this.wheatley.try_fetch_guild_member(user);
        if (!target) {
            await this.reply_with_error(command, "User is not a guild member");
            return;
        }
        if (!target.roles.cache.has(this.roles.voice.id)) {
            await this.reply_with_error(command, "User doesn't have voice");
            return;
        }
        await this.moderation_issue_handler(command, user, null, reason, { type: this.type });
    }

    private async handle_give(command: TextBasedCommand, user: Discord.User) {
        const target = await this.wheatley.try_fetch_guild_member(user);
        if (!target) {
            await this.reply_with_error(command, "User is not a guild member");
            return;
        }
        const issuer = await command.get_member();
        if (target.roles.highest.position >= issuer.roles.highest.position) {
            await this.reply_with_error(command, "You have no power over this user");
            return;
        }
        if (target.roles.cache.has(this.roles.voice.id)) {
            await this.reply_with_error(command, "User already has voice");
            return;
        }
        await this.moderation_revoke_handler(command, user, null, {}, { allow_no_entry: true });
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying voice take to ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.remove(this.roles.voice);
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing voice take from ${entry.user_name}`);
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.add(this.roles.voice);
        }
    }

    override async apply_revoke_to_discord(member: Discord.GuildMember): Promise<void> {
        await member.roles.add(this.roles.voice);
    }

    async is_moderation_applied_in_discord(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        const member = await this.wheatley.try_fetch_guild_member(moderation.user);
        if (member) {
            return !member.roles.cache.has(this.roles.voice.id);
        }
        return false;
    }
}
