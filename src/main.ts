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

import { strict as assert } from "assert";
import { critical_error, init_debugger, M } from "./utils.js";

import { DatabaseInterface } from "./infra/database-interface.js";
import { fetch_root_mod_list } from "./common.js";

import { Wheatley } from "./wheatley.js";

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
        Discord.GatewayIntentBits.MessageContent,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.DirectMessageReactions,
        Discord.GatewayIntentBits.DirectMessageTyping,
    ],
    partials: [
        Discord.Partials.Channel,
        Discord.Partials.Message,
        Discord.Partials.Reaction,
    ],
    makeCache: Discord.Options.cacheWithLimits({
        ...Discord.Options.DefaultMakeCacheSettings,
        MessageManager: 1000
    })
});

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
        new Wheatley(client, await DatabaseInterface.create());
    } catch(e) {
        critical_error(e);
    }
}

(() => {
    main();
})();

// don't crash, try to restart
process.on("uncaughtException", error => {
    critical_error("uncaughtException", error);
    main();
});
