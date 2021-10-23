import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";
import { action_log_channel_id, color, is_authorized_admin, pepereally } from "./common";

let action_log_channel: Discord.TextChannel;

const snowflake_re = /\b\d{18}\b/g;

function do_mass_ban(msg: Discord.Message) {
	// TODO: Do DM logic?
	// TODO: Set entry.purged if necessary?
	M.debug("Heard massban command");
	assert(msg.guild != null);
	let ids = msg.content.match(snowflake_re);
	if(ids != null && ids.length > 0) {
		M.log("Banning...");
		msg.channel.send("Banning...");
		M.debug(ids);
		for(let id of ids) {
			msg.guild.members.ban(id, {reason: "[[Wheatly]] User-Specified Mass-ban"});
		}
		msg.reply("Done.");
		// TODO: use long-message logic?
		const embed = new Discord.MessageEmbed()
		     .setColor(color)
		     .setTitle(`<@!${msg.author.id}> banned ${ids.length} users`)
		     .setDescription(`\`\`\`\n${ids.join("\n")}\n\`\`\``)
		     .setTimestamp();
		action_log_channel.send({ embeds: [embed] });
	}
}

function on_message(message: Discord.Message) {
	if(message.content.startsWith("!wban")) {
		assert(message.member != null);
		if(is_authorized_admin(message.member)) {
			do_mass_ban(message);
		} else {
			message.reply(`Unauthorized ${pepereally}`);
		}
	}
}

export function setup_massban(client: Discord.Client) {
	client.on("ready", async () => {
		try {
			action_log_channel = await client.channels.fetch(action_log_channel_id) as Discord.TextChannel;
			assert(action_log_channel != null);
			client.on("messageCreate", on_message);
		} catch(e) {
			M.error(e);
		}
	});
}
