import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, diff_to_human, fetch_text_channel, M } from "../utils";
import { colors, MINUTE, welcome_channel_id } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

const NEW_USER_THRESHOLD = MINUTE * 30;

export class NotifyAboutBrandNewUsers extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    async notify_about_brand_new_user(member: Discord.GuildMember) {
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.alert_color)
            .setAuthor({
                name: `New User Warning: ${member.user.tag}`,
                iconURL: member.user.displayAvatarURL()
            })
            .setDescription(`User <@${member.user.id}>'s account was created at created at:`
                          + ` <t:${Math.round(member.user.createdTimestamp / 1000)}>\n`
                          + `Account age: ${diff_to_human(Date.now() - member.user.createdTimestamp)}`)
            .setFooter({
                text: `ID: ${member.id}`
            })
            .setTimestamp();
        await this.wheatley.welcome_channel!.send({ embeds: [embed] })
            .catch((...args: any[]) => critical_error(...args));
        //member_log_channel!.send(`<@!${zelis_id}>`);
    }

    async on_guild_member_add(member: Discord.GuildMember) {
        assert(Date.now() - member.user.createdTimestamp >= 0);
        if(Date.now() - member.user.createdTimestamp <= NEW_USER_THRESHOLD) {
            await this.notify_about_brand_new_user(member);
        }
    }
}
