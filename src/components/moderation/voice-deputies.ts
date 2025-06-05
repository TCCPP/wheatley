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

export default class VoiceDeputies extends BotComponent {
    private recently_in_voice = new SelfClearingSet<string>(5 * MINUTE);

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("quarantine", EarlyReplyMode.ephemeral)
                .set_permissions(Discord.PermissionFlagsBits.MoveMembers | Discord.PermissionFlagsBits.MuteMembers)
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
                .set_handler(this.on_quarantine.bind(this)),
        );
    }

    private async reply_with_error(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.red)
                    .setDescription(`${this.wheatley.emoji.error} ***${message}***`),
            ],
        });
    }

    private async on_quarantine(command: TextBasedCommand, user: Discord.User, reason: string | null) {
        const member = await this.wheatley.try_fetch_guild_member(user);
        if (member && (member.voice.channel || this.recently_in_voice.has(member.id))) {
            await member.timeout(3 * HOUR);
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
                                `<@${user.id}> was quarantined`,
                                `**Issuer:** <@${command.user.id}>`,
                                reason ? `**Reason:** ${reason}` : null,
                            ),
                        )
                        .setFooter({
                            text: `ID: ${user.id}`,
                        }),
                ],
            });
        } else {
            await this.reply_with_error(command, "specified user was not recently seen in voice");
        }
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (!new_state.channel && new_state.member) {
            this.recently_in_voice.insert(new_state.member.id);
        }
    }

    override async on_audit_log_entry_create(entry: Discord.GuildAuditLogsEntry): Promise<void> {
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
}
