import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { DatabaseInterface } from "./database_interface";
import { is_root, server_suggestions_channel_id, suggestion_dashboard_thread_id, TCCPP_ID } from "./common";
import { decode_snowflake, forge_snowflake } from "./snowflake";
import * as XXH from "xxhashjs"

let client: Discord.Client;

let TCCPP : Discord.Guild;

let suggestion_channel: Discord.TextChannel;

let thread: Discord.ThreadChannel;

const TRACKER_START_TIME = 1636693200000;
                        // 1614513881250

let database: DatabaseInterface;

let recovering = true;

const resolution_reacts = new Set([
	"🟢", "🔴", "🟡", "🚫"
]);

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

function get_message(id: string) {
	return new Promise<Discord.Message | undefined>((resolve, reject) => {
		suggestion_channel.messages.fetch(id)
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

function message_has_resolution_from_root(message: Discord.Message) {
	return false; // TODO
}

async function user_is_root(user: Discord.User) {
	try {
		return await TCCPP.members.fetch(user.id);
	} catch {
		return false;
	}
}

interface DiscordPartial<T> {
	partial: boolean;
	//fetch(): Promise<ReturnType<typeof InstanceType<T>["fetch"]>>;
	//fetch(): T["fetch"];
	//fetch(): T["fetch"];
	//fetch(): Promise<T>;
	fetch(): Promise<any>;
}

// TODO: Improve this utility and integrate it into more of the bot
async function departialize<T extends DiscordPartial<T>>(thing: T) {
	if(thing.partial) {
		return await thing.fetch();
	} else {
		return thing;
	}
}

/*
 * New messages:
 * - Send message on the dashboard
 * - Create database entry
 * On edit:
 * - If message is tracked, update it
 *   - TODO: What if not tracked? That's a problem.
 * On delete:
 * - If message is tracked, remove entry
 * On reaction
 * - If 🟢🔴🟡🚫 *and added by root* remove from dashboard
 * - TODO Log resolution?
 * On reaction remove
 * - TODO If 🟢🔴🟡🚫 *and there is no longer one present by a root member* re-add to dashboard
 * - TODO Log reopen?
 * State recovery:
 * - Check if original messages were deleted
 * - Update with edits if necessary
 * - Scan messages since last seen
 * - TODO Process unseen messages as if new
 * - TODO Handle new 🟢🔴🟡🚫 reactions
 */

// jump to message link
// include media in embed?

async function make_embed(message: Discord.Message) {
	assert(message.content != null);
	assert(message.author != null);
	let member: Discord.GuildMember | null = null;
	if(message.member == null) {
		try {
			member = await TCCPP.members.fetch(message.author.id);
		} catch {} // user could potentially not be in the server
	} else {
		member = message.member;
	}
	let name = member ? member.displayName : message.author.tag;
	return new Discord.MessageEmbed()
	          .setColor(color)
	          .setAuthor(`${name}`, message.author.displayAvatarURL())
	          .setDescription(message.content + `\n\n[click here to jump](${message.url})`)
	          .setTimestamp(message.createdAt);
}

async function process_message(message: Discord.Message) {
	try {
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
		assert(message.createdTimestamp == decode_snowflake(message.id)); // something I just want to check... TODO can remove later
	} catch(e) {
		critical_error("error during process_message", e)
	}
}

async function process_message_deletion(message_id: string) {
	try {
		assert(message_id in database.get<db_schema>("suggestion_tracker").suggestions);
		let entry = database.get<db_schema>("suggestion_tracker").suggestions[message_id];
		let status_message = await thread.messages.fetch(entry.status_message);
		await status_message.delete();
		delete database.get<db_schema>("suggestion_tracker").suggestions[message_id];
		database.update();
	} catch(e) {
		critical_error("error during process_message_deletion", e)
	}
}

async function check_message_update(message: Discord.Message) {
	assert(message.id in database.get<db_schema>("suggestion_tracker").suggestions);
	let entry = database.get<db_schema>("suggestion_tracker").suggestions[message.id];
	assert(message.content != null);
	let hash = xxh3(message.content);
	if(hash != entry.hash) {
		let status_message = await thread.messages.fetch(entry.status_message);
		const embed = await make_embed(message);
		status_message.edit({ embeds: [embed] });
		database.get<db_schema>("suggestion_tracker").suggestions[message.id].hash = hash;
		database.update();
	}
}

function on_message(message: Discord.Message) {
	if(recovering) return;
	if(message.channel.id != server_suggestions_channel_id) return;
	try {
		process_message(message);
	} catch(e) {
		critical_error(e);
	}
}

function on_message_delete(message: Discord.Message | Discord.PartialMessage) {
	if(recovering) return;
	if(message.channel.id != server_suggestions_channel_id) return;
	try {
		process_message_deletion(message.id);
	} catch(e) {
		critical_error(e);
	}
}

async function on_message_update(old_message: Discord.Message | Discord.PartialMessage,
                           new_message: Discord.Message | Discord.PartialMessage) {
	if(recovering) return;
	if(new_message.channel.id != server_suggestions_channel_id) return;
	try {
		check_message_update(await departialize(new_message));
	} catch(e) {
		critical_error(e);
	}
}

// Process a reaction, known to be a resolution reaction
// Is root checked here
async function process_reaction(_reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                                user: Discord.User                 | Discord.PartialUser) {
	let reaction = await departialize(_reaction);
	if(resolution_reacts.has(reaction.emoji.name!)) {
		let member: Discord.GuildMember | null = null;
		try {
			member = await suggestion_channel.guild.members.fetch(user.id);
		} finally {
			if(member != null && is_root(member)) {
				let message_id = reaction.message.id;
				if(message_id in database.get<db_schema>("suggestion_tracker").suggestions) {
					// remove status message
					let entry = database.get<db_schema>("suggestion_tracker").suggestions[message_id];
					let status_message = await thread.messages.fetch(entry.status_message);
					await status_message.delete();
					delete database.get<db_schema>("suggestion_tracker").suggestions[message_id];
					database.update();
					// TODO log
				} else {
					// already resolved
				}
			}
		}
	}
}

async function process_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
	                                   user: Discord.User                | Discord.PartialUser) {
	if(resolution_reacts.has(reaction.emoji.name!) && user_is_root(await departialize(user))) {
		let message = await departialize(reaction.message);
		if(!message_has_resolution_from_root(message)) {
			// reopen
			process_message(message);
		}
	}
}

function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                  user: Discord.User                | Discord.PartialUser) {
	if(recovering) return;
	if(reaction.message.channel.id != server_suggestions_channel_id) return;
	try {
		if(resolution_reacts.has(reaction.emoji.name!)) {
			process_reaction(reaction, user);
		}
	} catch(e) {
		critical_error(e);
	}
}

function on_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
                            user: Discord.User                | Discord.PartialUser) {
	if(recovering) return;
	if(reaction.message.channel.id != server_suggestions_channel_id) return;
	try {
	} catch(e) {
		critical_error(e);
	}
}

async function process_since_last_scanned() {
	while(true) {
		// TODO: Sort collection???
		let messages = await suggestion_channel.messages.fetch({
			limit: 100,
			after: forge_snowflake(database.state.suggestion_tracker.last_scanned_timestamp + 1)
		}, {cache: true });
		M.debug(messages.size);
		if(messages.size == 0) {
			break;
		}
		let arr: Discord.Message[] = [];
		for(let [_, message] of messages) {
			arr.push(message);
		}
		arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
		for(let message of arr) {
			M.debug("server_suggestion tracker process_since_last_scanned: New message found:", message);
			if(message.createdTimestamp > database.state.suggestion_tracker.last_scanned_timestamp) {
				assert(message.createdTimestamp == decode_snowflake(message.id));
				database.get<db_schema>("suggestion_tracker").last_scanned_timestamp = message.createdTimestamp;
			}
			await process_message(message); // will .update() database
		}
		break;
	}
}

async function on_ready() {
	try {
		M.debug("server_suggestion tracker handler on_ready");
		if(!("suggestion_tracker" in database.state)) {
			database.set<db_schema>("suggestion_tracker", {
				last_scanned_timestamp: TRACKER_START_TIME,
				suggestions: {}
			});
		}
		// fetches
		TCCPP = await client.guilds.fetch(TCCPP_ID);
		suggestion_channel = (await client.channels.fetch(server_suggestions_channel_id))! as Discord.TextChannel;
		assert(suggestion_channel != null);
		thread = (await suggestion_channel.threads.fetch(suggestion_dashboard_thread_id))!;
		assert(thread != null);
		M.debug("server_suggestion tracker handler fetched guilds/channels/threads");
		// setup event handlers
		client.on("messageCreate", on_message);
		client.on("messageDelete", on_message_delete);
		client.on("messageUpdate", on_message_update);
		client.on("messageReactionAdd", on_react);
		client.on("messageReactionRemove", on_reaction_remove);
		// recover from down time: check database entries and fetch since last_scanned_timestamp
		M.debug("server_suggestion tracker scanning database entries");
		for(let id in   database.get<db_schema>("suggestion_tracker").suggestions) {
			let message = await get_message(id);
			if(message == undefined) {
				// deleted
				M.debug(`server_suggestion tracker state recovery: Message was deleted: ${database.get<db_schema>("suggestion_tracker").suggestions[id]}`);
				process_message_deletion(id);
			} else {
				M.debug(`server_suggestion tracker state recovery: Message was updated: ${database.get<db_schema>("suggestion_tracker").suggestions[id]}`);
				check_message_update(message);
			}
			// FIXME: Check reactions
		}
		M.debug("server_suggestion tracker scanning since last seen");
		await process_since_last_scanned();
		recovering = false;
		M.debug("server_suggestion tracker finished scanning");
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
