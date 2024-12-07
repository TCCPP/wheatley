import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { build_description, time_to_human } from "../utils/strings.js";
import { equal } from "../utils/arrays.js";

export default class JoinLeaveLog extends BotComponent {
    override async on_guild_member_add(member: Discord.GuildMember) {
        this.wheatley.llog(this.wheatley.channels.staff_member_log, {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Member Joined")
                    .setAuthor({
                        name: member.user.username,
                        iconURL: member.displayAvatarURL(),
                    })
                    .setThumbnail(member.displayAvatarURL())
                    .setColor(colors.green)
                    .setDescription(`<@${member.user.id}> ${member.user.username}`)
                    .setFields({
                        name: "Account age",
                        value: time_to_human(Date.now() - member.user.createdTimestamp),
                    })
                    .setFooter({
                        text: `ID: ${member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }

    override async on_guild_member_remove(member: Discord.GuildMember | Discord.PartialGuildMember) {
        this.wheatley.llog(this.wheatley.channels.staff_member_log, {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Member Left")
                    .setAuthor({
                        name: member.user.username,
                        iconURL: member.displayAvatarURL(),
                    })
                    .setThumbnail(member.displayAvatarURL())
                    .setColor(colors.red)
                    .setDescription(`<@${member.user.id}> ${member.user.username}`)
                    .setFooter({
                        text: `ID: ${member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        const old_roles = old_member.roles.cache.map(role => role.id);
        const new_roles = new_member.roles.cache.map(role => role.id);
        const extra_description: string[] = [];
        if (!equal(old_roles, new_roles)) {
            for (const role of new Set([...old_roles, ...new_roles])) {
                if (old_roles.includes(role) && !new_roles.includes(role)) {
                    extra_description.push(`Removed <@&${role}>`);
                }
                if (!old_roles.includes(role) && new_roles.includes(role)) {
                    extra_description.push(`Added <@&${role}>`);
                }
            }
        }
        if (old_member.displayName != new_member.displayName) {
            extra_description.push(`Old display name: ${old_member.displayName}`);
            extra_description.push(`New display name: ${new_member.displayName}`);
        }
        this.wheatley.llog(this.wheatley.channels.staff_member_log, {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Member Updated")
                    .setAuthor({
                        name: new_member.user.username,
                        iconURL: new_member.displayAvatarURL(),
                    })
                    .setThumbnail(new_member.displayAvatarURL())
                    .setColor(colors.default)
                    .setDescription(
                        build_description(`<@${new_member.user.id}> ${new_member.user.username}`, ...extra_description),
                    )
                    .setFooter({
                        text: `ID: ${new_member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }
}
