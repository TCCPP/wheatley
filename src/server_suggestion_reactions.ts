import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { illuminator_id, is_root, MINUTE, server_suggestions_channel_id, suggestion_dashboard_thread_id } from "./common";
import { critical_error, delay, M } from "./utils";
import { TRACKER_START_TIME } from "./server_suggetsion_tracker";
import { forge_snowflake } from "./snowflake";

let client: Discord.Client;

let monitored_channels: Map<string, Discord.TextChannel>;
let monitored_channels_ids = [server_suggestions_channel_id, suggestion_dashboard_thread_id];

const root_only_reacts = new Set([
	"🟢", "🔴", "🟡",
	"🟩", "🟥", "🟨",
	"✅", "⛔",
	"❎", "🚫", "⭕", "🅾️",
	"🫑", "🍏", "🎾", "🍅", "🍎", "🏮"
]);

async function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                        user: Discord.User                | Discord.PartialUser) {
	try {
		if(monitored_channels_ids.indexOf(reaction.message.channel.id) > -1) {
			if(reaction.users.cache.some(user => user.id == illuminator_id)) {
				// Remove but not immediately
				M.debug("scheduling illuminator reaction removal");
				setTimeout(() => {
					M.debug("removing illuminator reaction from", reaction.message);
					reaction.users.remove(illuminator_id);
				}, 5 * MINUTE);
			} else if(root_only_reacts.has(reaction.emoji.name!)) {
				if(!is_root(user)) {
					M.debug("removing non-root reaction", {
						content: reaction.message.content,
						reaction: reaction.emoji.name,
						user: [user.tag, user.id]
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
		let users = await reaction.users.fetch();
		for(let [id, user] of users) {
			if(id == illuminator_id) {
				M.debug("removing illuminator reaction from", message);
				reaction.users.remove(illuminator_id);
			} else if(root_only_reacts.has(reaction.emoji.name!)) {
				if(!is_root(user)) {
					M.debug("removing non-root reaction", {
						content: reaction.message.content,
						reaction: reaction.emoji.name,
						user: [user.tag, user.id]
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
	let server_suggestions_channel = monitored_channels.get(server_suggestions_channel_id);
	let last_seen = TRACKER_START_TIME;
	assert(server_suggestions_channel != undefined);
	while(true) {
		await delay(3 * MINUTE);
		let messages = await server_suggestions_channel.messages.fetch({
			limit: 100,
			after: forge_snowflake(last_seen) + 1
		});
		M.debug("root only reactions hard_catch_up", messages.size);
		if(messages.size == 0) {
			break;
		}
		for(let [_, message] of messages) {
			handle_fetched_message(message);
			if(message.createdTimestamp > last_seen) {
				last_seen = message.createdTimestamp;
			}
		}
	}
}

async function on_ready() {
	try {
		M.debug("server_suggestion reactions handler on_ready");
		// get the suggestion channel
		monitored_channels = new Map();
		for(let channel_id of monitored_channels_ids) {
			let channel = (await client.channels.fetch(channel_id))! as Discord.TextChannel;
			assert(channel != null);
			monitored_channels.set(channel_id, channel);
		}
		M.debug("server_suggestion reactions handler got channels");
		// setup listener only after channel is fetched
		client.on("messageReactionAdd", on_react); // Note: This event only fires for cached messages for some reason
		M.debug("server_suggestion reactions handler set messageReactionAdd handler");
		// recover from down time: fetch last 100 messages (and add to cache)
		for(let [_, channel] of monitored_channels) {
			let messages = await channel.messages.fetch({ limit: 100 }, { cache: true });
			for(let [_, message] of messages) {
				handle_fetched_message(message);
			}
		}
		// hard catch up, fuck you CLU <3
		hard_catch_up();
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
