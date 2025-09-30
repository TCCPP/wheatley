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
import * as Sentry from "@sentry/node";

import { M } from "./utils/debugging-and-logging.js";

import { wheatley_config, Wheatley } from "./wheatley.js";
import JSONC from "jsonc-parser";
import fs from "fs";

async function main() {
    // Setup client
    const client = new Discord.Client({
        intents: [
            // fuck it, everything (almost)
            Discord.GatewayIntentBits.Guilds,
            Discord.GatewayIntentBits.GuildMembers,
            Discord.GatewayIntentBits.GuildModeration,
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
            Discord.Partials.User,
        ],
        makeCache: Discord.Options.cacheWithLimits({
            ...Discord.Options.DefaultMakeCacheSettings,
            MessageManager: 1000,
        }),
    });

    // Suggestion tracking
    // deleted suggestion -> wastebin
    // log resolution in suggestions_log thread
    // if changed to unresolved put back in suggestion tracker thread
    // new suggestions -> suggestion tracker
    // maintain database of ids
    // suggestion tracker: Content, author, votes, link.

    client.on("ready", () => {
        M.log(`Logged in as ${client.user!.tag}`);
    });

    M.info("Starting wheatley");
    M.info(`Node version: ${process.versions.node}`);

    // reading sync is okay here, we can't do anything in parallel anyway
    const config: wheatley_config = JSONC.parse(fs.readFileSync("config.jsonc", { encoding: "utf-8" }));

    if (config.sentry) {
        Sentry.init({
            dsn: config.sentry,
        });
    }

    try {
        new Wheatley(client, config);
    } catch (e) {
        M.error(e);
    }
}

(async () => {
    return main();
})().catch(M.error);

process.on("uncaughtException", error => {
    M.error("uncaughtException", error);
    process.exit(1);
});

// Last line of defense
process.on("unhandledRejection", (reason, promise) => {
    M.error(`unhandledRejection ${reason} ${promise}`);
});
