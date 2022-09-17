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

import { MemberTracker } from "./infra/member_tracker";
import { DatabaseInterface } from "./infra/database_interface";
import { fetch_root_mod_list } from "./common";

import { setup_anti_autoreact } from "./components/anti_autoreact";
import { setup_server_suggestion_reactions } from "./components/server_suggestion_reactions";
import { setup_role_manager } from "./components/role_manager";
import { setup_raidpurge } from "./components/raidpurge";
import { setup_notify_about_brand_new_users } from "./components/notify_about_brand_new_users";
import { setup_anti_raid } from "./components/anti_raid";
import { setup_speedrun } from "./components/speedrun";
import { setup_anti_scambot } from "./components/anti_scambot";
import { setup_tracked_mentions } from "./components/tracked_mentions";
import { setup_massban } from "./components/massban";
import { setup_test_command } from "./test/test_command";
import { setup_snowflake } from "./components/snowflake";
import { setup_nodistractions } from "./components/nodistractions";
import { setup_server_suggestion_tracker } from "./components/server_suggetsion_tracker";
import { setup_quote } from "./components/quote";
import { setup_ping } from "./components/ping";
import { setup_link_blacklist } from "./components/link_blacklist";
import { setup_utility_tools } from "./components/utility_tools";
import { setup_roulette } from "./components/roulette";
import { setup_pasta } from "./test/pasta";
import { setup_read_tutoring } from "./components/read_tutoring";
import { setup_test_module } from "./test/test_module";
import { setup_modmail } from "./components/modmail";
import { setup_thread_control } from "./components/thread_control";
import { setup_thread_based_channels } from "./components/thread_based_channels";
import { GuildCommandManager } from "./infra/guild_command_manager";
import { setup_status } from "./components/status";
import { setup_autoreact } from "./components/autoreact";
import { setup_username_manager } from "./components/username_manager";

// Setup client
const client = new Discord.Client({
    intents: [ // fuck it, everything (almost)
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildBans,
        Discord.GatewayIntentBits.GuildEmojisAndStickers,
        Discord.GatewayIntentBits.GuildIntegrations,
        Discord.GatewayIntentBits.GuildWebhooks,
        Discord.GatewayIntentBits.GuildInvites,
        Discord.GatewayIntentBits.GuildVoiceStates,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMessageReactions,
        Discord.GatewayIntentBits.GuildMessageTyping,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.DirectMessageReactions,
        Discord.GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
        Discord.Partials.Channel
    ],
    makeCache: Discord.Options.cacheWithLimits({
        MessageManager: 1000
    })
});

// Every module sets a lot of listeners. This is not a leak.
client.setMaxListeners(30);

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

async function main() {
    try {
        const database = await DatabaseInterface.create();
        const tracker = new MemberTracker(client);
        const guild_command_manager = new GuildCommandManager();

        await setup_anti_autoreact(client);
        await setup_server_suggestion_reactions(client);
        await setup_server_suggestion_tracker(client, database);
        await setup_autoreact(client);
        await setup_role_manager(client);
        await setup_test_command(client);
        await setup_massban(client);
        await setup_snowflake(client);
        await setup_quote(client);
        await setup_ping(client, guild_command_manager);
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
        await setup_pasta(client, guild_command_manager);
        await setup_test_module(client);
        await setup_modmail(client, database);
        await setup_thread_control(client);
        await setup_thread_based_channels(client);
        await setup_status(client);
        await setup_username_manager(client);

        const token = readFileSync("auth.key", { encoding: "utf-8" });

        await guild_command_manager.finalize(token);

        M.debug("Logging in");

        client.on("error", error => {
            M.error(error);
        });

        client.login(token);
    } catch(e) {
        critical_error(e);
    }
}

(() => {
    main();
})();

// don't crash, try to restart
process.on("uncaughtException", error => {
    M.error("uncaughtException", error);
    main();
});
