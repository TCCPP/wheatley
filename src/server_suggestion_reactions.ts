import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { illuminator_id, is_root, MINUTE, server_suggestions_channel_id } from "./common";
import { critical_error, M } from "./utils";

let client: Discord.Client;
let suggestion_channel: Discord.TextChannel;

const root_only_reacts = new Set([
	"🟢", "🔴", "🟡",
	"🟩", "🟥", "🟨",
	"✅", "⛔",
	"❎", "🚫", "⭕", "🅾️",
	"🫑", "🍏", "🎾", "🍅", "🍎", "🏮"
]);

async function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                        user: Discord.User | Discord.PartialUser) {
	try {
		if(reaction.message.channel.id == server_suggestions_channel_id) {
			if(reaction.users.cache.some(user => user.id == illuminator_id)) {
				// Remove but not immediately
				M.debug("scheduling illuminator reaction removal");
				setTimeout(() => {
					M.debug("removing illuminator reaction from", reaction.message);
					reaction.users.remove(illuminator_id);
				}, 5 * MINUTE);
			} else if(root_only_reacts.has(reaction.emoji.name!)) {
				let member: Discord.GuildMember | null = null;
				try {
					member = await suggestion_channel.guild.members.fetch(user.id);
				} finally {
					if(member == null || !is_root(member)) {
						M.debug("removing non-root reaction", {
							content: reaction.message.content,
							reaction: reaction.emoji.name,
							user: [user.tag, user.id]
						});
						reaction.users.remove(user.id);
					}
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
				let member: Discord.GuildMember | null = null;
				try {
					member = await suggestion_channel!.guild.members.fetch(user.id);
				} finally {
					if(member == null || !is_root(member)) {
						M.debug("removing non-root reaction", {
							content: reaction.message.content,
							reaction: reaction.emoji.name,
							user: [user.tag, user.id]
						});
						reaction.users.remove(id);
					}
				}
			}
		}
	});
}

async function on_ready() {
	try {
		M.debug("server_suggestion reactions handler on_ready");
		// get the suggestion channel
		suggestion_channel = (await client.channels.fetch(server_suggestions_channel_id))! as Discord.TextChannel;
		assert(suggestion_channel != null);
		M.debug("server_suggestion reactions handler got suggestion_channel");
		// setup listener only after channel is fetched
		client.on("messageReactionAdd", on_react); // Note: This event only fires for cached messages for some reason
		M.debug("server_suggestion reactions handler set messageReactionAdd handler");
		// recover from down time: fetch last 100 messages (and add to cache)
		let messages = await suggestion_channel.messages.fetch({ limit: 100 }, { cache: true });
		for(let [_, message] of messages) {
			await handle_fetched_message(message);
		}
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
