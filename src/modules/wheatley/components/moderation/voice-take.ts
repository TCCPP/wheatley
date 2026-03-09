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
import { channel_has_member_with_role } from "../../../../utils/discord.js";
import {
    perform_voice_update,
    select_everyone,
    exclude_bots,
    select_without_role,
    type VoiceUpdateContext,
} from "../../../../utils/voice-update.js";

export default class VoiceTake extends ModerationComponent {
    private readonly roles = role_map(this.wheatley, wheatley_roles.voice, wheatley_roles.voice_moderator);

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
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("update", EarlyReplyMode.ephemeral)
                        .set_description("Force-refresh voice permissions in your current channel")
                        .add_boolean_option({
                            title: "all",
                            description:
                                "Refresh everyone (required on non-TCCPP). Omit on TCCPP for affected users only.",
                            required: false,
                        })
                        .set_handler(this.handle_update.bind(this)),
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

    private async handle_update(command: TextBasedCommand, all: boolean | null) {
        const member = await command.get_member();
        if (!member.permissions.has(Discord.PermissionFlagsBits.MoveMembers)) {
            await this.reply_with_error(command, "You need the Move Members permission to use this command.");
            return;
        }
        const channel = member.voice.channel;
        if (!channel || !channel.isVoiceBased()) {
            await this.reply_with_error(command, "You must be in a voice channel to use this command.");
            return;
        }
        const on_tccpp = this.wheatley.components.has("PermissionManager");
        if (!all && !on_tccpp) {
            await this.reply_with_error(
                command,
                "Specify `all: true` to refresh everyone. (The affected-user mode is only available on TCCPP.)",
            );
            return;
        }
        const context: VoiceUpdateContext = {
            guild: this.wheatley.guild,
            caller: member,
            channel,
            wheatley: this.wheatley,
        };
        const selector = all ? exclude_bots(select_everyone) : exclude_bots(select_without_role(this.roles.voice.id));
        const result = await perform_voice_update(context, selector);
        if (result.afk_missing) {
            await this.reply_with_error(
                command,
                "No AFK channel is configured for this guild, so voice refresh cannot run.",
            );
            return;
        }
        const scope = all ? "" : " affected";
        const skipped_suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
        await command.reply({
            content:
                `Refreshed voice permissions for ${result.succeeded}${scope} member(s) in ${channel.name}.` +
                skipped_suffix +
                (result.failed > 0 ? ` (${result.failed} failed)` : ""),
            should_text_reply: true,
        });
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying voice take to ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.remove(this.roles.voice);
            const channel = member.voice.channel;
            if (channel && !channel_has_member_with_role(channel, this.roles.voice_moderator.id)) {
                await this.wheatley.force_voice_permissions_update(member);
            }
        }
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing voice take from ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.try_fetch_guild_member(entry.user);
        if (member) {
            await member.roles.add(this.roles.voice);
            const channel = member.voice.channel;
            if (channel && !channel_has_member_with_role(channel, this.roles.voice_moderator.id)) {
                await this.wheatley.force_voice_permissions_update(member);
            }
        }
    }

    override async apply_revoke_to_discord(member: Discord.GuildMember): Promise<void> {
        await member.roles.add(this.roles.voice);
        const channel = member.voice.channel;
        if (channel && !channel_has_member_with_role(channel, this.roles.voice_moderator.id)) {
            await this.wheatley.force_voice_permissions_update(member);
        }
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
