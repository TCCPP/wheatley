import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { time_to_human } from "../utils/strings.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { discord_timestamp } from "../utils/discord.js";

const NEW_USER_THRESHOLD = MINUTE * 30;

export default class NotifyAboutBrandNewUsers extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    async notify_about_brand_new_user(member: Discord.GuildMember) {
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.alert_color)
            .setAuthor({
                name: `New User Warning: ${member.user.tag}`,
                iconURL: member.user.displayAvatarURL(),
            })
            .setDescription(
                `User <@${member.user.id}>'s account was created at created at:` +
                    ` ${discord_timestamp(member.user.createdTimestamp)}\n` +
                    `Account age: ${time_to_human(Date.now() - member.user.createdTimestamp)}`,
            )
            .setFooter({
                text: `ID: ${member.id}`,
            })
            .setTimestamp();
        await this.wheatley.channels.welcome
            .send({ embeds: [embed] })
            .catch(reason => this.wheatley.critical_error(reason));
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        assert(Date.now() - member.user.createdTimestamp >= 0);
        if (Date.now() - member.user.createdTimestamp <= NEW_USER_THRESHOLD) {
            await this.notify_about_brand_new_user(member);
        }
    }
}
