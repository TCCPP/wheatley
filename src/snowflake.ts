import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { TCCPP_ID } from "./common";

let client: Discord.Client;

const snowflake_command_re = /!snowflake\s*(\d+)/i;
const DISCORD_EPOCH = 1420070400000;

export function decode_snowflake(snowflake_text: string) {
	let snowflake = BigInt.asUintN(64, BigInt(snowflake_text));
	return DISCORD_EPOCH + Number(snowflake >> 22n); // milliseconds
}

export function forge_snowflake(timestamp: number) {
	assert(timestamp > DISCORD_EPOCH);
	let snowflake = BigInt(timestamp - DISCORD_EPOCH) << 22n;
	return snowflake.toString();
}

function on_message(message: Discord.Message) {
	try {
		if(message.author.id == client.user!.id) return; // Ignore self
		if(message.author.bot) return; // Ignore bots
		if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
		let match = message.content.match(snowflake_command_re);
		if(match != null) {
			assert(match.length == 2);
			let timestamp = decode_snowflake(match[1]);
			message.channel.send(`<t:${Math.round(timestamp / 1000)}>`);
		}
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_snowflake(_client: Discord.Client) {
	try {
		client = _client;
		client.on("messageCreate", on_message);
	} catch(e) {
		critical_error(e);
	}
}
