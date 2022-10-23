import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, diff_to_human, fetch_text_channel, M } from "../utils";
import { colors, MINUTE, welcome_channel_id } from "../common";

const NEW_USER_THRESHOLD = MINUTE * 30;

let member_log_channel: Discord.TextChannel;

async function notify_about_brand_new_user(member: Discord.GuildMember) {
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
    await member_log_channel!.send({ embeds: [embed] })
        .catch((...args: any[]) => critical_error(...args));
    //member_log_channel!.send(`<@!${zelis_id}>`);
}

async function on_join(member: Discord.GuildMember) {
    try {
        assert(Date.now() - member.user.createdTimestamp >= 0);
        if(Date.now() - member.user.createdTimestamp <= NEW_USER_THRESHOLD) {
            await notify_about_brand_new_user(member);
        }
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_notify_about_brand_new_users(client: Discord.Client) {
    M.debug("Setting up notify_about_brand_new_users");
    client.on("ready", async () => {
        try {
            member_log_channel = await fetch_text_channel(welcome_channel_id);
            M.debug("notify_about_brand_new_users: member_log_channel channel fetched");
            client.on("guildMemberAdd", on_join);
        } catch(e) {
            critical_error(e);
        }
    });
}
