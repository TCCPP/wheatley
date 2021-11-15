import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { is_authorized_admin } from "./common";

let client: Discord.Client;

let color = 0x7E78FE; //0xA931FF;

async function on_message(message: Discord.Message) {
	try {
		if(message.author.bot) return; // Ignore bots
		if(message.content == "!wping"
		|| message.content == "!wstatus"
		&& is_authorized_admin(message.member!)) {
			M.log("got ping command");
			message.channel.send({embeds: [
				new Discord.MessageEmbed()
					.setColor(color)
					.setTitle("pong")
			]});
		}
	} catch(e) {
		critical_error(e);
		try {
			message.reply("Internal error while replying to !wping");
		} catch(e) {
			critical_error(e);
		}
	}
}

async function on_ready() {
	try {
		client.on("messageCreate", on_message);
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_ping(_client: Discord.Client) {
	try {
		client = _client;
		client.on("ready", on_ready);
	} catch(e) {
		critical_error(e);
	}
}
