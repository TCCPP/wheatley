import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { time_to_human } from "../utils/strings.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { discord_timestamp } from "../utils/discord.js";

const NEW_USER_THRESHOLD = MINUTE * 30;

export default class NotifyAboutBrandNewUsers extends BotComponent {
    private welcome: Discord.TextChannel;

    override async setup(commands: any) {
        this.welcome = await this.utilities.get_channel(this.wheatley.channels.welcome);
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
        await this.welcome.send({ embeds: [embed] });
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        const age = Date.now() - member.user.createdTimestamp;
        assert(age >= 0);
        if (age <= NEW_USER_THRESHOLD) {
            await this.notify_about_brand_new_user(member);
        }
    }
}
