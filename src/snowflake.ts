import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";
import { color, is_authorized_admin } from "./common";

const snowflake_command_re = /!snowflake\s*(\d+)/i;
const discordEpoch = 1420070400000;

function on_message(message: Discord.Message) {
	let match = message.content.match(snowflake_command_re);
	if(match != null) {
		assert(match.length == 2);
		let arg = match[1];
		let snowflake = BigInt.asUintN(64, BigInt(arg));
		let timestamp = snowflake >> 22n;
		//const date = new Date(dateBits + discordEpoch);
		message.channel.send(`<t:${Math.round((discordEpoch + Number(timestamp)) / 1000)}>`);
	}
}

export async function setup_snowflake(client: Discord.Client) {
	client.on("messageCreate", on_message);
}
