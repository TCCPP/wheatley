import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { is_root, MINUTE, server_suggestions_channel_id, suggestion_dashboard_thread_id } from "../common";
import { critical_error, delay, M } from "../utils";
import { TRACKER_START_TIME } from "./server_suggestion_tracker";
import { forge_snowflake } from "./snowflake";
import { react_blacklist } from "../config";

let client: Discord.Client;

let monitored_channels: Map<string, Discord.TextChannel | Discord.AnyThreadChannel>;
const monitored_channels_ids = [ server_suggestions_channel_id, suggestion_dashboard_thread_id ];

const root_only_reacts = new Set([
    "🟢", "🔴", "🟡", "🔵",
    "🟩", "🟥", "🟨",
    "🚫",
    "❎", "✅",
    "🅾️", "⛔", "⭕", "❌", "🛑",
    "🫑", "🍏", "🎾", "🍅", "🍎", "🏮"
]);

async function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                        user: Discord.User                | Discord.PartialUser) {
    try {
        if(monitored_channels_ids.indexOf(reaction.message.channel.id) > -1) {
            if(reaction.users.cache.some(user => react_blacklist.has(user.id))) {
                // Remove but not immediately
                M.debug("scheduling blacklisted user reaction removal");
                setTimeout(() => {
                    M.log("removing reaction by blacklisted user from", {
                        content: reaction.message.content,
                        reaction: reaction.emoji.name,
                        time: reaction.message.createdAt,
                        user: [ user.tag, user.id ]
                    });
                    reaction.users.remove(user.id);
                }, 5 * MINUTE);
            } else if(root_only_reacts.has(reaction.emoji.name!)) {
                if(!is_root(user)) {
                    M.log("removing non-root reaction", {
                        content: reaction.message.content,
                        reaction: reaction.emoji.name,
                        time: reaction.message.createdAt,
                        user: [ user.tag, user.id ]
                    });
                    reaction.users.remove(user.id);
                }
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function handle_fetched_message(message: Discord.Message) {
    message.reactions.cache.forEach(async reaction => {
        const users = await reaction.users.fetch();
        ///M.debug(reaction.emoji.name, users.map(u => [u.id, u.tag]));
        for(const [ id, user ] of users) {
            if(react_blacklist.has(id)) {
                M.log("removing reaction by blacklisted user from", {
                    content: reaction.message.content,
                    reaction: reaction.emoji.name,
                    time: reaction.message.createdAt,
                    user: [ user.tag, user.id ]
                });
                reaction.users.remove(id);
            } else if(root_only_reacts.has(reaction.emoji.name!)) {
                if(!is_root(user)) {
                    M.log("removing non-root reaction", {
                        content: reaction.message.content,
                        reaction: reaction.emoji.name,
                        time: reaction.message.createdAt,
                        user: [ user.tag, user.id ]
                    });
                    reaction.users.remove(id);
                }
            }
        }
    });
}

// handle *everything* since TRACKER_START_TIME
// 100 messages every 3 minutes, avoid ratelimits
// runs only on restart, no rush
async function hard_catch_up() {
    const server_suggestions_channel = monitored_channels.get(server_suggestions_channel_id);
    let oldest_seen = Date.now();
    assert(server_suggestions_channel != undefined);
    while(true) {
        await delay(3 * MINUTE);
        const messages = await server_suggestions_channel.messages.fetch({
            limit: 100,
            before: forge_snowflake(oldest_seen - 1)
        });
        M.debug("fetched during root only reactions HARD CATCH UP", messages.size);
        if(messages.size == 0) {
            break;
        }
        for(const [ _, message ] of messages) {
            if(message.createdTimestamp < TRACKER_START_TIME) {
                oldest_seen = TRACKER_START_TIME;
                continue;
            }
            await handle_fetched_message(message);
            if(message.createdTimestamp < oldest_seen) {
                oldest_seen = message.createdTimestamp;
            }
        }
        if(oldest_seen <= TRACKER_START_TIME) {
            break;
        }
    }
    M.debug("FINISHED HARD CATCH UP");
}

async function on_ready() {
    try {
        M.debug("server_suggestion reactions handler on_ready");
        // get the suggestion channel
        monitored_channels = new Map();
        for(const channel_id of monitored_channels_ids) {
            const channel = await client.channels.fetch(channel_id);
            assert(channel && (channel instanceof Discord.TextChannel || channel instanceof Discord.ThreadChannel));
            monitored_channels.set(channel_id, channel);
        }
        M.debug("server_suggestion reactions handler got channels");
        // setup listener only after channel is fetched
        client.on("messageReactionAdd", on_react); // Note: This event only fires for cached messages for some reason
        M.debug("server_suggestion reactions handler set messageReactionAdd handler");
        // recover from down time: fetch last 100 messages (and add to cache)
        for(const [ _, channel ] of monitored_channels) {
            const messages = await channel.messages.fetch({ limit: 100, cache: true });
            for(const [ _, message ] of messages) {
                await handle_fetched_message(message);
            }
        }
        // hard catch up, fuck you CLU <3
        await hard_catch_up();
    } catch(e) {
        critical_error(e);
    }
}

export function setup_server_suggestion_reactions(_client: Discord.Client) {
    try {
        M.debug("Setting up server_suggestion reactions handler");
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
