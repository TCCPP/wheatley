/*
 * Features:
 *   Log mentions of @moderator and @root
 *   Log attempts to @everyone or @here
 *   Log exact join/ban times for TCCPP ban speedrun reasons
 *   Autoremove certain annoying autoreacts
 *   Autoremove Pink roles when users stop boosting
 *   Autoremove duplicate skill roles
 *   Autoban scammers. Identified based off of spamming @here/@everyone or links across channels.
 *   Protect 🟢, 🔴, 🟡, 🟩, 🟥, 🟨, and 🚫 in #server_suggestions
 *   Anti-illuminator: Remove illuminator reactions in #server_suggestions
 *   Warn and notify when a bot wave is incoming
 *     IMPORTANT: This mitigation will only work until the botters realize what we've done!
 *     This mitigation is easy to counter if the botters put in effort to do so - just stagger joins
 *     instead of doing them all at once. The mitigation is not revolutionary, the botters probably
 *     have considered this, but still good to keep implementation details less than public.
 *   !raidpurge (may only be used in #welcome)
 *     Quick-ban bot wave
 *   !wban <list of IDS, any format works as long as they're word-separated>
 *   !snowflake <ID>
 */

import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";
import { readFileSync } from "fs";
import { action_log_channel_id, color, is_authorized_admin, member_log_channel_id, pepereally,
         welcome_channel_id} from "./common";
import { setup_anti_autoreact } from "./anti_autoreact"
import { setup_server_suggestion_reactions } from "./server_suggestion_reactions";
import { setup_role_manager } from "./role_manager";
import { setup_raidpurge } from "./raidpurge";
import { setup_notify_about_brand_new_users } from "./notify_about_brand_new_users";
import { MemberTracker } from "./member_tracker";
import { setup_anti_raid } from "./anti_raid";
import { setup_speedrun } from "./speedrun";
import { setup_anti_scambot } from "./anti_scambot";
import { setup_tracked_mentions } from "./tracked_mentions";

// Setup client
const client = new Discord.Client({
	intents: [ // fuck it, everything (almost)
		Discord.Intents.FLAGS.GUILDS,
		Discord.Intents.FLAGS.GUILD_MEMBERS,
		Discord.Intents.FLAGS.GUILD_BANS,
		Discord.Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS,
		Discord.Intents.FLAGS.GUILD_INTEGRATIONS,
		Discord.Intents.FLAGS.GUILD_WEBHOOKS,
		Discord.Intents.FLAGS.GUILD_INVITES,
		Discord.Intents.FLAGS.GUILD_VOICE_STATES,
		Discord.Intents.FLAGS.GUILD_MESSAGES,
		Discord.Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		Discord.Intents.FLAGS.GUILD_MESSAGE_TYPING,
		Discord.Intents.FLAGS.DIRECT_MESSAGES,
		Discord.Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
		Discord.Intents.FLAGS.DIRECT_MESSAGE_TYPING,
	]
});

// Configuration
const snowflake_re = /\b\d{18}\b/g;

let action_log_channel: Discord.TextChannel | null = null;
let member_log_channel: Discord.TextChannel | null = null;
let welcome_channel   : Discord.TextChannel | null = null;

// Suggestion tracking
// deleted suggestion -> wastebin
// log resolution in suggestions_log thread
// if changed to unresolved put back in suggestion tracker thread
// new suggestions -> suggestion tracker
// maintain database of ids
// suggestion tracker: Content, author, votes, link.

function do_mass_ban(msg: Discord.Message) {
	// TODO: Do DM logic?
	// TODO: Set entry.purged if necessary?
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
		action_log_channel!.send({ embeds: [embed] });
	}
}

const snowflake_command_re = /!snowflake\s*(\d+)/i;
const discordEpoch = 1420070400000;

client.on("messageCreate", msg => {
	// ignore self and other bots
	if(msg.author.id == client.user!.id) return;
	if(msg.author.bot) return;
	// commands
	if(msg.content.startsWith("!wban")) {
		assert(msg.member != null);
		if(is_authorized_admin(msg.member)) {
			do_mass_ban(msg);
		} else {
			msg.reply(`Unauthorized ${pepereally}`);
		}
	}
	if(msg.content == "!wtest") {
		msg.reply(`test`);
		const embed = new Discord.MessageEmbed()
					 .setColor(color)
					 .setAuthor(`${msg.author.username}#${msg.author.discriminator}`, msg.author.displayAvatarURL())
					 .setDescription(`test test`)
					 .setFooter(`ID: ${msg.author.id}`)
					 .setTimestamp();
		msg.channel.send({ embeds: [embed] });
	}
	let match = msg.content.match(snowflake_command_re);
	if(match != null) {
		assert(match.length == 2);
		let arg = match[1];
		let snowflake = BigInt.asUintN(64, BigInt(arg));
		let timestamp = snowflake >> 22n;
		//const date = new Date(dateBits + discordEpoch);
		msg.channel.send(`<t:${Math.round((discordEpoch + Number(timestamp)) / 1000)}>`);
	}
});

client.on("ready", () => {
	M.log(`Logged in as ${client.user!.tag}`);
	client.channels.fetch(action_log_channel_id)
		  .then(c => action_log_channel = c as Discord.TextChannel)
		  .catch(M.error);
	client.channels.fetch(member_log_channel_id)
		.then(c => member_log_channel = c as Discord.TextChannel)
		.catch(M.error);
	client.channels.fetch(welcome_channel_id)
		  .then(c => welcome_channel = c as Discord.TextChannel)
		  .catch(M.error);
});

setup_anti_autoreact(client);
setup_server_suggestion_reactions(client);
setup_role_manager(client);
let tracker = new MemberTracker(client);
setup_tracked_mentions(client);
setup_raidpurge(client, tracker);
setup_notify_about_brand_new_users(client);
setup_anti_raid(client, tracker);
setup_speedrun(client, tracker);
setup_anti_scambot(client, tracker);

client.login(readFileSync("auth.key", { encoding: "utf-8" }));

// join link:
// https://discord.com/oauth2/authorize?client_id=597216680271282192&scope=bot&permissions=519270
