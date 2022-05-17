/*
 * Functionality:
 *   Log mentions of @moderator and @root
 *   Log attempts to @everyone or @here
 *   Log exact join/ban times for TCCPP ban speedrun reasons
 *   Autoremove certain annoying autoreacts
 *   Autoremove Pink roles when users stop boosting
 *   Autoremove duplicate skill roles
 *   Autoban scammers. Identified based off of spamming @here/@everyone or links across channels.
 *   Protect 🟢, 🔴, 🟡, 🟩, 🟥, 🟨, and 🚫 in #server_suggestions
 *   Warn and notify when a bot wave is incoming
 *   !raidpurge (may only be used in #welcome)
 *     Quick-ban bot wave
 *   !wban <list of IDS, any format works as long as they're word-separated>
 *   !snowflake <ID>
 *   ... and more
 */

import * as Discord from "discord.js";
import { readFileSync } from "fs";

import { strict as assert } from "assert";
import { critical_error, init_debugger, M } from "./utils";

import { MemberTracker } from "./member_tracker";
import { DatabaseInterface } from "./database_interface";
import { fetch_root_mod_list } from "./common";

import { setup_anti_autoreact } from "./anti_autoreact";
import { setup_server_suggestion_reactions } from "./server_suggestion_reactions";
import { setup_role_manager } from "./role_manager";
import { setup_raidpurge } from "./raidpurge";
import { setup_notify_about_brand_new_users } from "./notify_about_brand_new_users";
import { setup_anti_raid } from "./anti_raid";
import { setup_speedrun } from "./speedrun";
import { setup_anti_scambot } from "./anti_scambot";
import { setup_tracked_mentions } from "./tracked_mentions";
import { setup_massban } from "./massban";
import { setup_test_command } from "./test_command";
import { setup_snowflake } from "./snowflake";
import { setup_nodistractions } from "./nodistractions";
import { setup_server_suggestion_tracker } from "./server_suggetsion_tracker";
import { setup_quote } from "./quote";
import { setup_ping } from "./ping";
import { setup_link_blacklist } from "./link_blacklist";
import { setup_utility_tools } from "./utility_tools";
import { setup_roulette } from "./roulette";
import { setup_pasta } from "./pasta";
import { setup_read_tutoring } from "./read_tutoring";
import { setup_test_module } from "./test_module";

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

client.on("ready", async () => {
    M.log(`Logged in as ${client.user!.tag}`);
    //client.user!.setStatus("invisible");
    fetch_root_mod_list(client); // fetch list of roots and mods, replace hard-coded list
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
        const database = await DatabaseInterface.create();
        const tracker = new MemberTracker(client);

        await setup_anti_autoreact(client);
        await setup_server_suggestion_reactions(client);
        await setup_server_suggestion_tracker(client, database);
        await setup_role_manager(client);
        await setup_test_command(client);
        await setup_massban(client);
        await setup_snowflake(client);
        await setup_quote(client);
        await setup_ping(client);
        await setup_roulette(client, database);
        await setup_nodistractions(client, database);
        await setup_tracked_mentions(client);
        await setup_raidpurge(client, tracker);
        await setup_notify_about_brand_new_users(client);
        await setup_anti_raid(client, tracker);
        await setup_speedrun(client, tracker);
        await setup_anti_scambot(client, tracker);
        await setup_link_blacklist(client, database);
        await setup_utility_tools(client);
        await setup_read_tutoring(client);
        await setup_pasta(client);
        await setup_test_module(client);

        const token = readFileSync("auth.key", { encoding: "utf-8" });

        M.debug("Logging in");

        client.login(token);
    } catch(e) {
        critical_error(e);
    }
})();

// join link:
// https://discord.com/oauth2/authorize?client_id=597216680271282192&scope=bot&permissions=519270
// https://discord.com/api/oauth2/authorize?client_id=597216680271282192&permissions=8&redirect_uri=https%3A%2F%2Fdiscordapp.com%2Foauth2%2Fauthorize%3F%26client_id%3D597216680271282192%26scope%3Dbot&response_type=code&scope=guilds%20guilds.join%20guilds.members.read%20bot%20messages.read%20applications.commands%20applications.store.update%20applications.entitlements%20activities.read%20activities.write%20relationships.read
// https://discordapp.com/oauth2/authorize?&client_id=597216680271282192&scope=bot&permissions=8
