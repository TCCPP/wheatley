import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../../utils/debugging-and-logging.js";
import { colors, HOUR, MINUTE } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { SelfClearingSet } from "../../../../utils/containers.js";
import { build_description } from "../../../../utils/strings.js";
import { unwrap } from "../../../../utils/misc.js";

export default class VoiceModeration extends BotComponent {
    private recently_in_voice = new SelfClearingSet<string>(5 * MINUTE);
    private staff_action_log!: Discord.TextChannel;
    private voice_hotline!: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
        this.voice_hotline = await this.utilities.get_channel(this.wheatley.channels.voice_hotline);

        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_category("Misc")
                .set_permissions(Discord.PermissionFlagsBits.MoveMembers | Discord.PermissionFlagsBits.MuteMembers)
                .set_description("Voice moderation")
                .add_subcommand(
                    new TextBasedCommandBuilder("mute", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                        .set_description("mute person")
                        .add_user_option({
                            description: "User to mute",
                            title: "user",
                            required: true,
                        })
                        .add_string_option({
                            description: "Reason",
                            title: "reason",
                            required: false,
                        })
                        .set_handler(this.wrap_command_handler(this.handle_mute.bind(this))),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("unmute", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                        .set_description("unmute person")
                        .add_user_option({
                            description: "User to unmute",
                            title: "user",
                            required: true,
                        })
                        .add_string_option({
                            description: "Reason",
                            title: "reason",
                            required: false,
                        })
                        .set_handler(this.wrap_command_handler(this.handle_unmute.bind(this))),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("give", EarlyReplyMode.ephemeral)
                        .set_description("Give voice")
                        .add_user_option({
                            description: "User to receive voice",
                            title: "user",
                            required: true,
                        })
                        .set_handler(this.wrap_command_handler(this.handle_give_voice.bind(this))),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("take", EarlyReplyMode.ephemeral)
                        .set_description("Take voice")
                        .add_user_option({
                            description: "User to lose voice",
                            title: "user",
                            required: true,
                        })
                        .add_string_option({
                            description: "Reason",
                            title: "reason",
                            required: false,
                        })
                        .set_handler(this.wrap_command_handler(this.handle_take_voice.bind(this))),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("quarantine", EarlyReplyMode.ephemeral)
                        .set_description("Quarantine member")
                        .add_user_option({
                            description: "User to quarantine",
                            title: "user",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(this.wrap_command_handler(this.handle_quarantine.bind(this))),
                ),
        );
    }

    private wrap_command_handler<Args extends unknown[] = []>(
        handler: (command: TextBasedCommand, target: Discord.GuildMember, ...args: Args) => Promise<void>,
    ) {
        return async (command: TextBasedCommand, user: Discord.User, ...args: Args) => {
            const target = await this.wheatley.try_fetch_guild_member(user);
            if (!target) {
                await this.reply_error(command, "target is not a guild member");
                return;
            }
            const issuer = unwrap(await this.wheatley.try_fetch_guild_member(command.user));
            if (target.roles.highest.position >= issuer.roles.highest.position) {
                await this.reply_error(command, "you have no power over this user");
                return;
            }
            await handler(command, target, ...args);
        };
    }

    private async reply_success(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setDescription(`${this.wheatley.emoji.success} ***${message}***`),
            ],
        });
    }

    private async reply_error(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.red)
                    .setDescription(`${this.wheatley.emoji.error} ***${message}***`),
            ],
        });
    }

    static case_summary(
        target: Discord.User | Discord.PartialUser | null,
        issuer: Discord.User | Discord.PartialUser,
        action: string,
        reason?: string,
    ) {
        return new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setAuthor(
                target
                    ? {
                          name: target.displayName,
                          iconURL: target.avatarURL() ?? target.displayAvatarURL(),
                      }
                    : null,
            )
            .setDescription(
                build_description(
                    (target ? `<@${target.id}> ` : "User ") + action,
                    `**Issuer:** <@${issuer.id}>`,
                    reason ? `**Reason:** ${reason}` : null,
                ),
            )
            .setFooter(
                target
                    ? {
                          text: `ID: ${target.id}`,
                      }
                    : null,
            );
    }

    async log_action(
        target: Discord.User | Discord.PartialUser | null,
        issuer: Discord.User | Discord.PartialUser,
        action: string,
        reason?: string,
    ) {
        const summary = VoiceModeration.case_summary(target, issuer, action, reason);
        await this.staff_action_log.send({
            embeds: [summary],
            allowedMentions: { parse: [] },
        });
        return summary;
    }

    private async log_and_reply_success(
        command: TextBasedCommand,
        target: Discord.User | Discord.PartialUser,
        issuer: Discord.User | Discord.PartialUser,
        action: string,
        reason?: string,
    ) {
        await this.log_action(target, issuer, action, reason);
        await this.reply_success(command, `${target.displayName} was ` + action);
    }

    private async handle_mute(command: TextBasedCommand, target: Discord.GuildMember, reason: string | null) {
        if (!target.voice.serverMute) {
            await this.reply_error(command, "user is already muted");
            return;
        }
        await target.voice.setMute(true, reason ?? undefined);
        await this.log_and_reply_success(command, target.user, command.user, "was muted", reason ?? undefined);
    }

    private async handle_unmute(command: TextBasedCommand, target: Discord.GuildMember, reason: string | null) {
        if (!target.voice.serverMute) {
            await this.reply_error(command, "user is not currently muted");
            return;
        }
        await target.voice.setMute(false, reason ?? undefined);
        await this.log_and_reply_success(command, target.user, command.user, "was unmuted", reason ?? undefined);
    }

    private async handle_give_voice(command: TextBasedCommand, target: Discord.GuildMember) {
        if (target.roles.cache.some(r => r.id == this.wheatley.roles.voice.id)) {
            await this.reply_error(command, "user already has voice");
            return;
        }
        await target.roles.add(this.wheatley.roles.voice);
        await this.log_and_reply_success(command, target.user, command.user, "was given voice");
    }

    private async handle_take_voice(command: TextBasedCommand, target: Discord.GuildMember, reason: string | null) {
        if (!target.roles.cache.some(r => r.id == this.wheatley.roles.voice.id)) {
            await this.reply_error(command, "user doesn't have voice");
            return;
        }
        await target.roles.remove(this.wheatley.roles.voice);
        await this.log_and_reply_success(command, target.user, command.user, "was devoiced", reason ?? undefined);
    }

    private async handle_quarantine(command: TextBasedCommand, target: Discord.GuildMember, reason: string | null) {
        if (!target.voice.channel && !this.recently_in_voice.has(target.id)) {
            await this.reply_error(command, "user was not recently seen in voice");
            return;
        }

        await target.timeout(3 * HOUR);
        const summary = await this.log_action(target.user, command.user, "was quarantined");
        await this.voice_hotline.send({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            embeds: [summary.setColor(colors.alert_color)],
        });
        await this.reply_success(command, `${target.displayName} was quarantined`);
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        // Track "recently in voice" for quarantine purposes
        if (!new_state.channel && new_state.member) {
            this.recently_in_voice.insert(new_state.member.id);
        }
    }

    override async on_audit_log_entry_create(entry: Discord.GuildAuditLogsEntry): Promise<void> {
        if (!entry.executor || entry.executorId == this.wheatley.user.id) {
            return;
        }

        if (entry.action == Discord.AuditLogEvent.MemberUpdate) {
            for (const change of entry.changes) {
                if (change.key == "mute") {
                    assert(entry.targetType == "User");
                    await this.log_action(
                        entry.target as Discord.User,
                        entry.executor,
                        change.old ? "was unmuted" : "was muted",
                    );
                }
            }
        } else if (entry.action == Discord.AuditLogEvent.MemberMove) {
            await this.log_action(null, entry.executor, "was moved");
        } else if (entry.action == Discord.AuditLogEvent.MemberDisconnect) {
            await this.log_action(null, entry.executor, "was disconnected");
        }
    }

    override async on_message_create(message: Discord.Message) {
        if (
            message.channel.isVoiceBased() &&
            message.mentions.roles.has(this.wheatley.roles.moderators.id) &&
            !message.mentions.roles.has(this.wheatley.roles.voice_moderator.id) &&
            !(await this.wheatley.try_fetch_guild_member(message.author))?.roles.cache.has(
                this.wheatley.roles.voice_moderator.id,
            )
        ) {
            await message.channel.send(`<@&${this.wheatley.roles.voice_moderator.id}>`);
        }
    }
}
