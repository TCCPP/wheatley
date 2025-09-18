import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../utils/debugging-and-logging.js";
import { colors, HOUR, MINUTE } from "../../common.js";
import { BotComponent } from "../../bot-component.js";
import { CommandSetBuilder } from "../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { SelfClearingSet } from "../../utils/containers.js";
import { build_description } from "../../utils/strings.js";
import { unwrap } from "../../utils/misc.js";

export default class VoiceDeputies extends BotComponent {
    private recently_in_voice = new SelfClearingSet<string>(5 * MINUTE);

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_permissions(Discord.PermissionFlagsBits.MoveMembers | Discord.PermissionFlagsBits.MuteMembers)
                .set_description("Voice moderation")
                .add_subcommand(
                    new TextBasedCommandBuilder("give", EarlyReplyMode.ephemeral)
                        .set_description("Give voice")
                        .add_user_option({
                            description: "User to receive voice",
                            title: "user",
                            required: true,
                        })
                        .set_handler(this.wrap_command_handler(this.on_give_voice.bind(this))),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("take", EarlyReplyMode.ephemeral)
                        .set_description("Take voice")
                        .add_user_option({
                            description: "User to lose voice",
                            title: "user",
                            required: true,
                        })
                        .set_handler(this.wrap_command_handler(this.on_take_voice.bind(this))),
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
                        .set_handler(this.wrap_command_handler(this.on_quarantine.bind(this))),
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

    private async on_give_voice(command: TextBasedCommand, target: Discord.GuildMember) {
        if (target.roles.cache.some(r => r.id == this.wheatley.roles.voice.id)) {
            await this.reply_error(command, "user already has voice");
            return;
        }
        await target.roles.add(this.wheatley.roles.voice);
        await this.reply_success(command, `<@${target.id}> now has voice`);
    }

    private async on_take_voice(command: TextBasedCommand, target: Discord.GuildMember) {
        if (!target.roles.cache.some(r => r.id == this.wheatley.roles.voice.id)) {
            await this.reply_error(command, "user doesn't have voice");
            return;
        }
        await target.roles.remove(this.wheatley.roles.voice);
        await this.reply_success(command, `<@${target.id}> doesn't have voice anymore`);
    }

    private async on_quarantine(command: TextBasedCommand, target: Discord.GuildMember, reason: string | null) {
        if (!target.voice.channel && !this.recently_in_voice.has(target.id)) {
            await this.reply_error(command, "user was not recently seen in voice");
            return;
        }

        await target.timeout(3 * HOUR);
        await this.wheatley.channels.voice_hotline.send({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setAuthor({
                        name: command.user.displayName,
                        iconURL: command.user.avatarURL() ?? command.user.displayAvatarURL(),
                    })
                    // .setTitle(`Moderator Alert!`)
                    .setDescription(
                        build_description(
                            `<@${target.id}> was quarantined`,
                            `**Issuer:** <@${command.user.id}>`,
                            reason ? `**Reason:** ${reason}` : null,
                        ),
                    )
                    .setFooter({
                        text: `ID: ${target.id}`,
                    }),
            ],
        });
        await this.reply_success(command, `<@${target.id}> was quarantined`);
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (!new_state.channel && new_state.member) {
            this.recently_in_voice.insert(new_state.member.id);
        }
    }

    override async on_audit_log_entry_create(entry: Discord.GuildAuditLogsEntry): Promise<void> {
        if (entry.executorId == this.wheatley.user.id) {
            return;
        }

        if (entry.action == Discord.AuditLogEvent.MemberUpdate) {
            for (const change of entry.changes) {
                if (change.key == "mute") {
                    await this.wheatley.channels.voice_hotline.send(
                        `<@${entry.targetId}> was ${change.old ? "unmuted" : "muted"} by <@${entry.executorId}>`,
                    );
                }
            }
        } else if (entry.action == Discord.AuditLogEvent.MemberMove) {
            await this.wheatley.channels.voice_hotline.send(`user was moved by <@${entry.executorId}>`);
        } else if (entry.action == Discord.AuditLogEvent.MemberDisconnect) {
            await this.wheatley.channels.voice_hotline.send(`user was disconnected by <@${entry.executorId}>`);
        }
    }

    override async on_message_create(message: Discord.Message) {
        if (
            message.channel.isVoiceBased() &&
            message.mentions.roles.has(this.wheatley.roles.moderators.id) &&
            !message.mentions.roles.has(this.wheatley.roles.voice_deputy.id)
        ) {
            await message.channel.send(`<@&${this.wheatley.roles.voice_deputy.id}>`);
        }
    }
}
