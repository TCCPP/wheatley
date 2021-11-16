import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, departialize, M, Mutex, SelfClearingSet } from "./utils";
import { DatabaseInterface } from "./database_interface";
import { is_root, MINUTE, server_suggestions_channel_id, suggestion_action_log_thread_id, suggestion_dashboard_thread_id, TCCPP_ID, wheatley_id } from "./common";
import { forge_snowflake } from "./snowflake";
import * as XXH from "xxhashjs"

let client: Discord.Client;
let TCCPP : Discord.Guild;

let database: DatabaseInterface;

let suggestion_channel: Discord.TextChannel;
let thread:             Discord.ThreadChannel;
let log_thread:         Discord.ThreadChannel;

export const TRACKER_START_TIME =
                                  1625112000000; // Thu Jul 01 2021 00:00:00 GMT-0400 (Eastern Daylight Time)
                               // 1630468800000; // Wed Sep 01 2021 00:00:00 GMT-0400 (Eastern Daylight Time)
                               // 1636693200000; // debug: Fri Nov 12 2021 00:00:00 GMT-0500 (Eastern Standard Time)
let recovering = true;

const resolution_reactions = [
	"🟢", "🔴", "🟡", "🚫"
];
const resolution_reactions_set = new Set(resolution_reactions);

type db_schema = {
	last_scanned_timestamp: number;
	suggestions: { [key: string]: db_entry }; // Mapping from suggestion snowflake to db_entry
};

type db_entry = {
	status_message: string // dashboard snowflake
	hash: string // to check if message is updated, currently using xxh3 (64-bit hash)
};

let color = 0x7E78FE; //0xA931FF;

// utilities

function xxh3(message: string) {
	return XXH.h64().update(message).digest().toString(16);
}

function get_message(channel: Discord.TextChannel | Discord.ThreadChannel, id: string) {
	return new Promise<Discord.Message | undefined>((resolve, reject) => {
		channel.messages.fetch(id, {cache: true })
			.then(m => resolve(m))
			.catch(e => {
				if(e.httpStatus == 404) {
					resolve(undefined);
				} else {
					reject(e);
				}
			});
	});
}

type reaction = {
	user: Discord.User,
	emoji: Discord.Emoji
};

async function message_has_resolution_from_root(message: Discord.Message) {
	let roots: reaction[] = [];
	for(let [_, reaction] of message.reactions.cache) {
		if(resolution_reactions_set.has(reaction.emoji.name!)) {
			let users = await reaction.users.fetch();
			for(let [_, user] of users) {
				if(is_root(user)) {
					roots.push({user, emoji: reaction.emoji});
				}
			}
		}
	}
	if(roots.length > 0) {
		//M.debug("[sort]", roots.sort((a, b) => -a.user.id.localeCompare(b.user.id)).map(r => r.user.id));
		return roots.sort((a, b) => -a.user.id.localeCompare(b.user.id))[0];
	} else {
		return false;
	}
}

async function get_display_name(thing: Discord.Message | Discord.User): Promise<string> {
	if(thing instanceof Discord.User) {
		let user = thing;
		try {
			return (await TCCPP.members.fetch(user.id)).displayName;
		} catch {
			// user could potentially not be in the server
			return user.tag;
		}
	} else if(thing instanceof Discord.Message) {
		let message = thing;
		if(message.member == null) {
			return get_display_name(message.author);
			
		} else {
			return message.member.displayName;
		}
	} else {
		assert(false);
	}
}

function reverse_lookup(status_id: string) {
	let suggestion_id: string | null = null;
	for(let id in   database.get<db_schema>("suggestion_tracker").suggestions) {
		let entry = database.get<db_schema>("suggestion_tracker").suggestions[id];
		if(entry.status_message == status_id) {
			suggestion_id = id;
			break;
		}
	}
	return suggestion_id;
}

function isnt_actually_a_message(message: Discord.Message) {
	return message.type == "THREAD_CREATED" && message.thread == null;
}

/*
 * New messages:
 * - Send message on the dashboard
 * - Create database entry
 * On edit:
 * - If message is tracked, update it
 * On delete:
 * - If message is tracked, remove entry
 * On reaction
 * - If 🟢🔴🟡🚫 *and added by root* remove from dashboard
 * - Log resolution?
 * On reaction remove
 * - If 🟢🔴🟡🚫 *and there is no longer one present by a root member* re-add to dashboard
 * - Log reopen?
 * State recovery:
 * - Check if original messages were deleted
 * - Update with edits if necessary
 * - Scan messages since last seen
 * - Process unseen messages as if new if not already resolved
 * - Handle new 🟢🔴🟡🚫 reactions
 * - TODO: Handle removed 🟢🔴🟡🚫 reactions?
 * - Check for manual untracks
 * On 🟢🔴🟡🚫 reaction in the dashboard:
 * - Apply reaction to the main message and resolve suggestion
 *     Note: Not currently checked in recovery
 *     Note: Last 100 messages in the thread fetched and cached by server_suggestion_reactions
 * On status message delete in dashboard:
 * - Delete database entry. This is a manual "No longer tracking the message".
 *
 * If a message is not tracked it is either resolved or missed.
 */

// jump to message link
// include media in embed?

async function make_embed(message: Discord.Message) {
	assert(message.content != null);
	assert(message.author != null);
	return new Discord.MessageEmbed()
	          .setColor(color)
	          .setAuthor(`${await get_display_name(message)}`, message.author.displayAvatarURL())
	          .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
	          .setTimestamp(message.createdAt);
}

// Two log operations:
// - Log suggestion resolution
// - Log suggestion reopen
// Not logging deletions

async function log_resolution(message: Discord.Message, reaction: reaction) {
	let embed = new Discord.MessageEmbed()
	           .setColor(color)
	           .setAuthor(`${await get_display_name(message)}`, message.author.displayAvatarURL())
	           .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
	           .setFooter(`${await get_display_name(reaction.user)}: ${reaction.emoji}`, reaction.user.displayAvatarURL())
	           .setTimestamp(message.createdAt);
	await log_thread.send({ embeds: [ embed ] });
}

async function log_reopen(message: Discord.Message) {
	let embed = new Discord.MessageEmbed()
	           .setColor(color)
	           .setAuthor(`${await get_display_name(message)}`, message.author.displayAvatarURL())
	           .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
	           .setFooter("Suggestion reopened")
	           .setTimestamp(message.createdAt);
	await log_thread.send({ embeds: [ embed ] });
}

// Four operations:
// - open suggestion
// - delete suggestion TODO: misnomer
// - update suggestion if needed
// - resolve suggestion
// TODO: potentially may have reopen suggestion and untrack suggestion in the future
// Note: Callers obtain mutex lock

// Race condition handling: edits while processing edits, await status_message.delete() and on_message_delete() interfering, etc.
let mutex = new Mutex<string>();
let status_lock = new SelfClearingSet<string>(5 * MINUTE, 5 * MINUTE);

async function open_suggestion(message: Discord.Message) {
	try {
		M.debug("New suggestion", [message.author.tag, message.author.id, message.content]);
		const embed = await make_embed(message);
		let status_message = await thread.send({ embeds: [embed] });
		assert(!(message.id in database.get<db_schema>("suggestion_tracker").suggestions));
		if(message.createdTimestamp > database.get<db_schema>("suggestion_tracker").last_scanned_timestamp) {
			database.get<db_schema>("suggestion_tracker").last_scanned_timestamp = message.createdTimestamp;
		}
		database.get<db_schema>("suggestion_tracker").suggestions[message.id] = {
			status_message: status_message.id,
			hash: xxh3(message.content)
		};
		database.update();
		// add react options
		for(let r of resolution_reactions) {
			await status_message.react(r);
		}
	} catch(e) {
		critical_error("error during open_suggestion", e);
	}
}

async function delete_suggestion(message_id: string) {
	try {
		assert(message_id in database.get<db_schema>("suggestion_tracker").suggestions);
		let entry = database.get<db_schema>("suggestion_tracker").suggestions[message_id];
		M.debug("Suggestion deleted", message_id, entry);
		let status_message = await thread.messages.fetch(entry.status_message);
		status_lock.insert(entry.status_message);
		await status_message.delete();
		delete database.get<db_schema>("suggestion_tracker").suggestions[message_id];
		database.update();
	} catch(e) {
		critical_error("error during delete_suggestion", e);
	}
}

async function update_message_if_needed(message: Discord.Message) {
	try {
		if(!(message.id in database.get<db_schema>("suggestion_tracker").suggestions)) {
			// TODO: This can happen under normal operation, this is here as a debug check
			// TODO: Also happens when a thread is created directly, not off an initial message. Need to investigate why.
			M.warn("update_message_if_needed called on untracked message", message);
			return;
		}
		let entry = database.get<db_schema>("suggestion_tracker").suggestions[message.id];
		assert(message.content != null);
		let hash = xxh3(message.content);
		if(hash != entry.hash) {
			M.debug("Suggestion edited", [message.author.tag, message.author.id, message.content]);
			let status_message = await thread.messages.fetch(entry.status_message);
			const embed = await make_embed(message);
			status_message.edit({ embeds: [embed] });
			database.get<db_schema>("suggestion_tracker").suggestions[message.id].hash = hash;
			database.update();
			return true; // return if we updated
		}
		return false;
	} catch(e) {
		critical_error("error during update_message_if_needed", e);
	}
}

async function resolve_suggestion(message: Discord.Message, reaction: reaction) {
	try {
		if(message.id in database.get<db_schema>("suggestion_tracker").suggestions) {
			M.debug("Suggestion being resolved", [message.id]);
			// remove status message
			let entry = database.get<db_schema>("suggestion_tracker").suggestions[message.id];
			let status_message = await thread.messages.fetch(entry.status_message);
			status_lock.insert(entry.status_message);
			await status_message.delete();
			delete database.get<db_schema>("suggestion_tracker").suggestions[message.id];
			database.update();
			if(reaction.user.id != wheatley_id) { // if wheatley then this is logged when the reaction is done on the dashboard
				log_resolution(message, reaction);
			}
		} else {
			// already resolved
		}
	} catch(e) {
		critical_error("error during update_message_if_needed", e);
	}
}

async function on_message(message: Discord.Message) {
	if(recovering) return;
	if(isnt_actually_a_message(message)) return;
	if(message.channel.id != server_suggestions_channel_id) return;
	try {
		await mutex.lock(message.id);
		await open_suggestion(message);
		mutex.unlock(message.id);
	} catch(e) {
		critical_error(e);
	}
}

async function on_message_delete(message: Discord.Message | Discord.PartialMessage) {
	if(recovering) return;
	if(isnt_actually_a_message(message as Discord.Message)) return;
	try {
		if(message.channel.id == server_suggestions_channel_id) {
			if(!(message.id in database.get<db_schema>("suggestion_tracker").suggestions)) {
				M.info("Untracked message deleted", message); // TODO: This can happen under normal operation, this is here as a debug check
				return;
			}
			await mutex.lock(message.id);
			await delete_suggestion(message.id);
			mutex.unlock(message.id);
		} else if(message.channel.id == suggestion_dashboard_thread_id) {
			assert(message.author != null);
			if(message.author.id == wheatley_id && !status_lock.has(message.id)) { // race condition with await status_message.delete() checked here
				// find and delete database entry
				let suggestion_id = reverse_lookup(message.id);
				if(suggestion_id == null) {
					throw 0; // untracked  - this is an internal error or a race condition
				} else {
					M.info("server_suggestion tracker state recovery: Manual status delete",
						suggestion_id,
						database.get<db_schema>("suggestion_tracker").suggestions[suggestion_id]);
					delete database.get<db_schema>("suggestion_tracker").suggestions[suggestion_id];
					database.update();
				}
			}
		} else if(message.channel.id == suggestion_action_log_thread_id && message.author!.id == wheatley_id) {
			M.info("Wheatley message deleted", message);
		}
	} catch(e) {
		critical_error(e);
	}
}

async function on_message_update(old_message: Discord.Message | Discord.PartialMessage,
                                 new_message: Discord.Message | Discord.PartialMessage) {
	if(recovering) return;
	if(new_message.channel.id != server_suggestions_channel_id) return;
	try {
		await mutex.lock(new_message.id);
		await update_message_if_needed(await departialize(new_message));
		mutex.unlock(new_message.id);
	} catch(e) {
		critical_error(e);
	}
}

// Process a reaction, known to be a resolution reaction
// Is root checked here
async function process_reaction(_reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                                user: Discord.User                 | Discord.PartialUser) {
	let reaction = await departialize(_reaction);
	if(resolution_reactions_set.has(reaction.emoji.name!)) {
		if(is_root(user)) {
			resolve_suggestion(await departialize(reaction.message), {
				user: await departialize(user),
				emoji: reaction.emoji
			});
		}
	}
}

async function process_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
	                                   user: Discord.User                | Discord.PartialUser) {
	if(resolution_reactions_set.has(reaction.emoji.name!) && is_root(user)) {
		let message = await departialize(reaction.message);
		if(!await message_has_resolution_from_root(message)) {
			// reopen
			open_suggestion(message);
			log_reopen(message);
		}
	}
}

async function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                        user: Discord.User                | Discord.PartialUser) {
	if(recovering) return;
	try {
		if(reaction.message.channel.id == server_suggestions_channel_id) {
			if(resolution_reactions_set.has(reaction.emoji.name!)) {
				await mutex.lock(reaction.message.id);
				process_reaction(reaction, user);
				mutex.unlock(reaction.message.id);
			}
		} else if(reaction.message.channel.id == suggestion_dashboard_thread_id) {
			if(reaction.message.author!.id == wheatley_id
			&& user.id != wheatley_id // ignore self - this is important for autoreacts
			&& resolution_reactions_set.has(reaction.emoji.name!)
			&& is_root(user)) {
				// expensive-ish but this will be rare
				let suggestion_id = reverse_lookup(reaction.message.id);
				if(suggestion_id == null) {
					throw 0; // untracked  - this is an internal error or a race condition
				} else {
					await mutex.lock(reaction.message.id); // lock the status message NOTE: Assuming no identical snowflakes between channels, this should be pretty safe though
					let suggestion = await suggestion_channel.messages.fetch(suggestion_id);
					suggestion.react(reaction.emoji.name!);
					log_resolution(suggestion, {
						user: await departialize(user),
						emoji: reaction.emoji
					});
					mutex.unlock(reaction.message.id);
					// No further action done here: process_reaction will run when on_react will fires again as a result of suggestion.react
				}
			}
		}
	} catch(e) {
		critical_error(e);
		try {
			if(is_root(user)) { // only send diagnostics to root
				let member = await TCCPP.members.fetch(user.id);
				member.send("Error while resolving suggestion");
			}
		} catch(e) {
			critical_error(e);
		}
	}
}

async function on_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                            user: Discord.User                | Discord.PartialUser) {
	if(recovering) return;
	if(reaction.message.channel.id != server_suggestions_channel_id) return;
	try {
		await mutex.lock(reaction.message.id);
		process_reaction_remove(reaction, user);
		mutex.unlock(reaction.message.id);
	} catch(e) {
		critical_error(e);
	}
}

async function process_since_last_scanned() {
	// Note: No locking done here
	while(true) {
		// TODO: Sort collection???
		let messages = await suggestion_channel.messages.fetch({
			limit: 100,
			after: forge_snowflake(database.get<db_schema>("suggestion_tracker").last_scanned_timestamp + 1)
		}, {cache: true });
		M.debug("process_since_last_scanned", messages.size);
		if(messages.size == 0) {
			break;
		}
		let arr: Discord.Message[] = [];
		for(let [_, message] of messages) {
			arr.push(message);
		}
		arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
		for(let message of arr) {
			if(isnt_actually_a_message(message)) continue;
			let root_resolve = await message_has_resolution_from_root(message);
			if(root_resolve) {
				// already resolved, just log
				log_resolution(message, root_resolve);
				// update last seen
				if(message.createdTimestamp > database.get<db_schema>("suggestion_tracker").last_scanned_timestamp) {
					database.get<db_schema>("suggestion_tracker").last_scanned_timestamp = message.createdTimestamp;
				}
			} else {
				M.debug("server_suggestion tracker process_since_last_scanned: New message found:", message.id, message.author.tag, message.content);
				//if(message.createdTimestamp > database.state.suggestion_tracker.last_scanned_timestamp) {
				//	assert(message.createdTimestamp == decode_snowflake(message.id));
				//	database.get<db_schema>("suggestion_tracker").last_scanned_timestamp = message.createdTimestamp;
				//}
				await open_suggestion(message); // will .update() database
			}
		}
		break;
	}
}

async function on_ready() {
	try {
		M.debug("server_suggestion tracker handler on_ready");
		if(!database.has("suggestion_tracker")) {
			database.set<db_schema>("suggestion_tracker", {
				last_scanned_timestamp: TRACKER_START_TIME,
				suggestions: {}
			});
		}
		// fetches
		TCCPP = await client.guilds.fetch(TCCPP_ID);
		assert(TCCPP != null);
		suggestion_channel = (await client.channels.fetch(server_suggestions_channel_id))! as Discord.TextChannel;
		assert(suggestion_channel != null);
		thread = (await suggestion_channel.threads.fetch(suggestion_dashboard_thread_id))!;
		assert(thread != null);
		log_thread = (await suggestion_channel.threads.fetch(suggestion_action_log_thread_id))!;
		assert(log_thread != null);
		M.debug("server_suggestion tracker handler fetched guilds/channels/threads");
		// setup event handlers
		client.on("messageCreate", on_message);
		client.on("messageDelete", on_message_delete);
		client.on("messageUpdate", on_message_update);
		client.on("messageReactionAdd", on_react);
		client.on("messageReactionRemove", on_reaction_remove);
		// handle all new suggestions since last seen
		M.debug("server_suggestion tracker scanning since last seen");
		await process_since_last_scanned();
		M.debug("server_suggestion tracker finished scanning");
		recovering = false;
		// check database entries and fetch since last_scanned_timestamp
		M.debug("server_suggestion tracker checking database entries");
		for(let id in   database.get<db_schema>("suggestion_tracker").suggestions) {
			await mutex.lock(id);
			let entry = database.get<db_schema>("suggestion_tracker").suggestions[id];
			let message = await get_message(suggestion_channel, id);
			let suggestion_was_resolved = false;
			if(message == undefined) { // check if deleted
				// deleted
				M.debug(`server_suggestion tracker state recovery: Message was deleted:`, entry);
				status_lock.insert(entry.status_message);
				await delete_suggestion(id);
			} else {
				// check if message updated
				if(await update_message_if_needed(message)) {
					M.debug(`server_suggestion tracker state recovery: Message was updated:`, entry);
				}
				// check reactions
				//M.debug(message.content, message.reactions.cache.map(r => [r.emoji.name, r.count]));
				let root_resolve = await message_has_resolution_from_root(message);
				if(root_resolve) {
					M.warn("server_suggestion tracker state recovery: resolving message");
					suggestion_was_resolved = true;
					await resolve_suggestion(message, root_resolve);
				} else {
					// no action needed
				}
			}
			// check if the status message was deleted (if we didn't just delete it with resolve_suggestion)
			if(!suggestion_was_resolved && await get_message(thread, entry.status_message) == undefined) {
				// just delete from database - no longer tracking
				M.info("server_suggestion tracker state recovery: Manual status delete", id, entry);
				delete database.get<db_schema>("suggestion_tracker").suggestions[id];
			}
			// not currently checking root reactions on it - TODO?
			mutex.unlock(id);
		}
		database.update();
		M.debug("server_suggestion tracker finished checking database entries");
	} catch(e) {
		critical_error(e);
	}
}

export function setup_server_suggestion_tracker(_client: Discord.Client, _database: DatabaseInterface) {
	try {
		M.debug("Setting up server_suggestion tracker handler");
		client = _client;
		database = _database;
		client.on("ready", on_ready);
	} catch(e) {
		critical_error(e);
	}
}
