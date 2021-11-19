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
import { critical_error, init_debugger, M } from "./utils";
import { readFileSync } from "fs";
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
import { setup_massban } from "./massban";
import { setup_test_command } from "./test_command";
import { setup_snowflake } from "./snowflake";
import { DatabaseInterface } from "./database_interface";
import { setup_nodistractions } from "./nodistractions";
import { setup_server_suggestion_tracker } from "./server_suggetsion_tracker";
import { setup_quote } from "./quote";
import { setup_ping } from "./ping";

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
	],
	partials: [
		"CHANNEL"
	],
	makeCache: Discord.Options.cacheWithLimits({
		MessageManager: 1000
	})
});

// Every module sets a lot of listeners. This is not a leak.
client.setMaxListeners(20);

// Suggestion tracking
// deleted suggestion -> wastebin
// log resolution in suggestions_log thread
// if changed to unresolved put back in suggestion tracker thread
// new suggestions -> suggestion tracker
// maintain database of ids
// suggestion tracker: Content, author, votes, link.

client.on("ready", () => {
	M.log(`Logged in as ${client.user!.tag}`);
	client.user!.setStatus("invisible");
});

M.debug("Setting up services");


init_debugger(client);

M.debug("Setting up modules");

// Last line of defense
process.on("unhandledRejection", (reason, promise) => {
	critical_error("unhandledRejection", reason, promise);
});

(async () => {
	try {
		let database = await DatabaseInterface.create();
		let tracker = new MemberTracker(client);

		await setup_anti_autoreact(client);
		await setup_server_suggestion_reactions(client);
		await setup_server_suggestion_tracker(client, database);
		await setup_role_manager(client);
		await setup_test_command(client);
		await setup_massban(client);
		await setup_snowflake(client);
		await setup_quote(client);
		await setup_ping(client);
		await setup_nodistractions(client, database);
		await setup_tracked_mentions(client);
		await setup_raidpurge(client, tracker);
		await setup_notify_about_brand_new_users(client);
		await setup_anti_raid(client, tracker);
		await setup_speedrun(client, tracker);
		await setup_anti_scambot(client, tracker);
	
		M.debug("Logging in");
	
		client.login(readFileSync("auth.key", { encoding: "utf-8" }));
	} catch(e) {
		critical_error(e);
	}
})();

// join link:
// https://discord.com/oauth2/authorize?client_id=597216680271282192&scope=bot&permissions=519270
