import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { colors } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { build_description } from "../../../../utils/strings.js";

export default class VoiceModeration extends BotComponent {
    private staff_action_log!: Discord.TextChannel;

    override async setup() {
        this.staff_action_log = await this.utilities.get_channel(
            this.wheatley.channels.staff_action_log.id,
            this.wheatley.channels.staff_action_log.name,
        );
    }

    private audit_log_summary(
        target: Discord.User | Discord.PartialUser | null,
        issuer: Discord.User | Discord.PartialUser,
        action: string,
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
                build_description((target ? `<@${target.id}> ` : "User ") + action, `**Issuer:** <@${issuer.id}>`),
            )
            .setFooter(target ? { text: `ID: ${target.id}` } : null);
    }

    override async on_audit_log_entry_create(entry: Discord.GuildAuditLogsEntry, guild: Discord.Guild): Promise<void> {
        if (guild.id !== this.wheatley.guild.id) {
            return;
        }
        if (!entry.executor || entry.executorId == this.wheatley.user.id) {
            return;
        }

        if (entry.action == Discord.AuditLogEvent.MemberUpdate) {
            for (const change of entry.changes) {
                if (change.key == "mute") {
                    assert(entry.targetType == "User");
                    const action = change.old ? "was unmuted" : "was muted";
                    await this.staff_action_log.send({
                        embeds: [this.audit_log_summary(entry.target as Discord.User, entry.executor, action)],
                        allowedMentions: { parse: [] },
                    });
                }
            }
        } else if (entry.action == Discord.AuditLogEvent.MemberMove) {
            await this.staff_action_log.send({
                embeds: [this.audit_log_summary(null, entry.executor, "was moved")],
                allowedMentions: { parse: [] },
            });
        } else if (entry.action == Discord.AuditLogEvent.MemberDisconnect) {
            await this.staff_action_log.send({
                embeds: [this.audit_log_summary(null, entry.executor, "was disconnected")],
                allowedMentions: { parse: [] },
            });
        }
    }

    override async on_message_create(message: Discord.Message) {
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
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
