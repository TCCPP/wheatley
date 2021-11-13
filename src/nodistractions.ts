import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";
import { is_authorized_admin, no_off_topic, TCCPP_ID, zelis_id } from "./common";
import { DatabaseInterface } from "./database_interface";

let client: Discord.Client;

let TCCPP : Discord.Guild;
let zelis : Discord.User;

const nodistractions_re = /^!nodistractions\s*(\d*)\s*(\w*)/i;
const nodistractions_snowflake_re = /^!nodistractions\s*(\d*)\s*(\w*)\s*(\d{10,})/i;
const remove_nodistractions_snowflake_re = /^!removenodistractions\s*(\d{10,})/i;

let database: DatabaseInterface;

type no_distraction_entry = {
	id: Discord.Snowflake,
	start: number,
	duration: number
};

type database_entry = {
	start: number,
	duration: number
};

// Sorted by !nodistractions end time
let undistract_queue: no_distraction_entry[] = [];

let timer: NodeJS.Timer | null = null;

const INT_MAX = 0x7FFFFFFF;

/*
 * !nodistractions
 * - Apply role when commanded
 * - Make sure user isn't already in !nodistractions
 * - Make sure user doesn't already have @No Off Topic, otherwise susceptible to exploit
 * - Make entry in database
 * - Reschedule timer if necessary
 * - DM with instructions for how to end
 * On restart:
 * - Re-setup timers
 * On !removenodistractions:
 * - Remove from !nodistractions
 * - Make sure user is in !nodistractions otherwise susceptible to exploit
 * On remove from !nodistractions:
 * - Remove role and database entry
 */

function send_error(original_message: Discord.Message, message: string) {
	original_message.reply(`Error: ${message}`);
}

function parse_unit(u: string) {
	let factor = 1000; // in ms
	switch(u) {
		case "C":
		case "c":
			factor *= 100; // 100 years, fallthrough
		case "Y":
		case "y":
			factor *= 365; // 365 days, fallthrough
		case "d":
			factor *= 24; // 24 hours, fallthrough
		case "h":
			factor *= 60; // 60 minutes, fallthrough
		case "m":
			factor *= 60; // 60 seconds
			break;
		// Weeks and months can't be folded into the above as nicely
		case "w":
			factor *= 7 * parse_unit("d");
			break;
		case "M":
			factor *= 30 * parse_unit("d");
			break;
		default:
			return -1;
	}
	return factor;
}

async function handle_timer() {
	timer = null;
	try {
		// sanity checks
		assert(undistract_queue.length > 0);
		assert(undistract_queue[0].start + undistract_queue[0].duration <= Date.now());
		// pop entry and remove role
		let entry = undistract_queue.shift()!;
		let member = await TCCPP.members.fetch(entry.id);
		M.debug("removing !nodistractions", [member.id, member.user.tag]);
		if(member.roles.cache.some(r => r.id == no_off_topic)) { // might have been removed externally
			await member.roles.remove(no_off_topic);
		}
		member.send("You have been removed from !nodistractions");
		// remove database entry
		delete database.state.nodistractions[entry.id];
		database.update();
		// reschedule, intentionally not rescheduling
		if(undistract_queue.length > 0) {
			set_timer();
		}
	} catch(e) {
		M.error(e);
		zelis.send("critical error in handle_timer()");
	}
}

function set_timer() {
	assert(timer == null);
	assert(undistract_queue.length > 0);
	let next = undistract_queue[0];
	timer = setTimeout(handle_timer, next.start + next.duration - Date.now());
}

async function apply_no_distractions(target: Discord.GuildMember, message: Discord.Message, start: number, duration: number) {
	M.debug("Applying !nodistractions");
	assert(target != null);
	// error handling
	if(target.roles.cache.some(r => r.id == no_off_topic)) {
		if(target.id in database.state.nodistractions) {
			send_error(message, "You're already in !nodistractions");
		} else {
			send_error(message, "Nice try.");
			zelis.send(`Exploit attempt ${message.url}`);
		}
		return;
	}
	if(duration >= INT_MAX) { // prevent timer overflow
		send_error(message, "Invalid timeframe");
		return;
	}
	// apply role, dm, react
	try {
		await target.roles.add(no_off_topic);
	} catch(e) {
		M.error(e);
		return;
	}
	target.send("!nodistractions applied, use !removenodistractions to exit").catch(M.error);
	message.react("👍").catch(M.error);
	// make entry
	let entry: no_distraction_entry = {
		id: target.id,
		start,
		duration
	};
	let i = 0;
	for( ; i < undistract_queue.length; i++) {
		if(undistract_queue[i].start + undistract_queue[i].duration >= start + duration) {
			break;
		}
	}
	undistract_queue.splice(i, 0, entry);
	database.state.nodistractions[target.id] = {
		start,
		duration
	};
	database.update();
	// apply
	if(i == 0 && timer != null) {
		clearTimeout(timer);
		timer = null;
	}
	if(timer == null) {
		set_timer();
	}
}

async function early_remove_nodistractions(target: Discord.GuildMember, message: Discord.Message) {
	try {
		// checks
		assert(target.id in database.state.nodistractions);
		// timer
		let reschedule = timer != null;
		if(timer != null) {
			clearTimeout(timer);
			timer = null;
		}
		// remove role
		await target.roles.remove(no_off_topic);
		// check again
		assert(target.id in database.state.nodistractions);
		if(!undistract_queue.some(e => e.id == target.id)) {
			M.error("Not good");
			zelis.send("Not good");
		}
		// remove entry
		delete database.state.nodistractions[target.id];
		undistract_queue = undistract_queue.filter(e => e.id != target.id);
		database.update();
		message.react("👍").catch(M.error);
		target.send("You have been removed from !nodistractions");
		// reschedule if necessary
		if(reschedule && undistract_queue.length > 0) {
			set_timer();
		}
	} catch(e) {
		M.error(e);
		zelis.send("critical error in early_remove_nodistractions()");
	}
}

async function on_message(message: Discord.Message) {
	if(message.author.id == client.user!.id) return; // Ignore self
	if(message.author.bot) return; // Ignore bots

	if(message.content.trim().toLowerCase() == "!removenodistractions") {
		M.debug("Got !removenodistractions");
		let member = message.member;
		if(member == null) {
			try {
				member = await TCCPP.members.fetch(message.author.id);
			} catch(e) {
				M.error(e);
				message.reply("internal error with fetching user");
				zelis.send("internal error with fetching user");
				return;
			}
		}
		if(!member.roles.cache.some(r => r.id == no_off_topic)) {
			send_error(message, "You are not currently in !nodistractions");
			return;
		}
		if(!(member.id in database.state.nodistractions)) {
			send_error(message, "Nice try.");
			zelis.send(`Exploit attempt ${message.url}`);
			return;
		}
		early_remove_nodistractions(member, message);
		return;
	}

	// "!nodistractions 123d asdfdsaf".match(/^!nodistractions\s*(\d*)\s*(\w*)/)
	// [ "!nodistractions 123d", "123", "d" ]
	let match = message.content.match(nodistractions_re);
	if(match != null) {
		M.debug("Got !nodistractions", [message.author.id, message.author.tag]);
		assert(match.length == 3);
		let n = parseInt(match[1]);
		let u = match[2];
		if(n == NaN) {
			send_error(message, "Empty time field");
			return;
		}
		if(u == "") {
			send_error(message, "Missing units");
			return;
		}
		let factor = parse_unit(u);
		if(factor == -1) {
			send_error(message, "Unknown units");
			return;
		}
		M.debug("Timeframe: ", n, u, factor);
		let member = message.member;
		if(member == null) {
			try {
				member = await TCCPP.members.fetch(message.author.id);
			} catch(e) {
				M.error(e);
				message.reply("internal error with fetching user");
				zelis.send("internal error with fetching user");
				return;
			}
		}
		apply_no_distractions(member, message, message.createdTimestamp, n * factor);
	}
}

export async function setup_nodistractions(_client: Discord.Client, _database: DatabaseInterface) {
	client = _client;
	database = _database;
	client.on("ready", async () => {
		try {
			TCCPP = await client.guilds.fetch(TCCPP_ID);
			zelis = await client.users.fetch(zelis_id);
			assert(TCCPP != null);
			if(!("nodistractions" in database.state)) {
				database.state.nodistractions = {
					/*
					 * map of user id -> database_entry
					 */
				};
			}
			// load entries
			for(let [id, entry] of Object.entries(database.state.nodistractions) as [string, database_entry][]) {
				undistract_queue.push({
					id,
					start: entry.start,
					duration: entry.duration
				});
			}
			if(undistract_queue.length > 0) {
				undistract_queue.sort((a, b) => (a.start + a.duration) - (b.start + b.duration));
				set_timer();
			}
			// setup listener
			client.on("messageCreate", on_message);
		} catch(e) {
			M.error(e);
		}
	});
	
}
