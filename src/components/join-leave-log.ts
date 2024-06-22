import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { time_to_human } from "../utils/strings.js";

export default class JoinLeaveLog extends BotComponent {
    override async on_guild_member_add(member: Discord.GuildMember) {
        await this.wheatley.channels.staff_message_log.send({
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
        await this.wheatley.channels.staff_message_log.send({
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
        await this.wheatley.channels.staff_message_log.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Member Updated")
                    .setAuthor({
                        name: new_member.user.username,
                        iconURL: new_member.displayAvatarURL(),
                    })
                    .setThumbnail(new_member.displayAvatarURL())
                    .setColor(colors.default)
                    .setDescription(`<@${new_member.user.id}> ${new_member.user.username}`)
                    .setFooter({
                        text: `ID: ${new_member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }
}
