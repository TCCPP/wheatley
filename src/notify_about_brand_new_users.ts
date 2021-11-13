import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { alert_color, member_log_channel_id, MINUTE } from "./common";

const DO_PING_ON_NEW_USER = true;
const NEW_USER_THRESHOLD = MINUTE * 60;

let member_log_channel: Discord.TextChannel;

function notify_about_brand_new_user(member: Discord.GuildMember) {
	let embed = new Discord.MessageEmbed()
			   .setColor(alert_color)
			   .setAuthor(`New User Warning: ${member.user.tag}`, member.user.displayAvatarURL())
			   .setDescription(`User <@${member.user.id}>'s account was created at created at: <t:${Math.round(member.user.createdTimestamp / 1000)}>`)
			   .setFooter(`ID: ${member.id}`)
			   .setTimestamp();
	member_log_channel!.send({ embeds: [embed] })
		.catch((...args: any[]) => critical_error(...args));
	//member_log_channel!.send(`<@!${zelis_id}>`);
}

function on_join(member: Discord.GuildMember) {
	try {
		assert(Date.now() - member.user.createdTimestamp >= 0);
		if(Date.now() - member.user.createdTimestamp <= NEW_USER_THRESHOLD) {
			notify_about_brand_new_user(member);
		}
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_notify_about_brand_new_users(client: Discord.Client) {
	M.debug("Setting up notify_about_brand_new_users");
	client.on("ready", async () => {
		try {
			member_log_channel = await client.channels.fetch(member_log_channel_id) as Discord.TextChannel;
			assert(member_log_channel != null);
			M.debug("notify_about_brand_new_users: member_log_channel channel fetched");
			client.on("guildMemberAdd", on_join);
		} catch(e) {
			critical_error(e);
		}
	});
}
