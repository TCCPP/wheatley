import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { diff_to_human, M } from "./utils";
import { MemberTracker } from "./member_tracker";
import { action_log_channel_id, speedrun_color } from "./common";

let tracker: MemberTracker;
let client: Discord.Client;
let action_log_channel: Discord.TextChannel;

function on_ban(ban: Discord.GuildBan, now: number) {
	M.debug("speedrun check");
	let user = ban.user;
	// get user info
	let avatar = user.displayAvatarURL();
	assert(avatar != null);
	let index = tracker.entries.findIndex(e => e.id == user.id); // TODO: Revisit? Make a Map?
	if(index == -1) return;
	let entry = tracker.entries[index];
	if(entry.purged) {
		return; // ignore bans from !raidpurge
	}
	// .purged set by raidpurge (yes I know it's checked above), currently_banning used by anti-scambot
	let is_auto_ban = entry.purged || tracker.currently_banning.has(user.id);
	// make embed
	let embed = new Discord.MessageEmbed()
			.setColor(speedrun_color)
			.setAuthor(`Speedrun attempt: ${user.tag}`, avatar)
			.setDescription(`User <@${user.id}> joined at <t:${Math.round(entry.joined_at / 1000)}:T> and banned at <t:${Math.round(now / 1000)}:T>.`
			              + `\nFinal timer: ${diff_to_human(now - entry.joined_at)}.`
			              + (is_auto_ban ? "\n**AUTO BAN**" : ""))
			.setFooter(`ID: ${user.id}`)
			.setTimestamp();
	action_log_channel!.send({ embeds: [embed] });
}

export async function setup_speedrun(_client: Discord.Client, _tracker: MemberTracker) {
	client = _client;
	tracker = _tracker;
	M.debug("Setting up speedrun");
	client.on("ready", async () => {
		try {
			action_log_channel = await client.channels.fetch(action_log_channel_id) as Discord.TextChannel;
			assert(action_log_channel != null);
			M.debug("tracked_mentions: action_log_channel channel fetched");
			tracker.add_submodule({ on_ban });
		} catch(e) {
			M.error(e);
		}
	});
}
