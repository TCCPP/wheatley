import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "./utils";
import { action_log_channel_id, bot_spam_id, everyone_role_id, member_log_channel_id, MINUTE, TCCPP_ID } from "./common";

let client: Discord.Client;

const warned_users = new SelfClearingSet<string>(60 * MINUTE);

let member_log_channel : Discord.TextChannel;
let action_log_channel : Discord.TextChannel;

const green = 0x31ea6c;
const red = 0xed2d2d;

function make_click_embed(author: Discord.User) {
	return new Discord.MessageEmbed()
	          .setColor(green)
	          .setDescription(`Click. <@${author.id}> got lucky.`);
}

function make_bang_embed(author: Discord.User) {
	return new Discord.MessageEmbed()
	          .setColor(red)
	          .setDescription(`BANG. <@${author.id}> is dead <a:saber:851241060553326652>`);
}

function make_ban_embed(message: Discord.Message) {
	const author = message.author;
	return new Discord.MessageEmbed()
	          .setColor(red)
	          .setDescription(`BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ) [roulette](${message.url}) and is being timed out for half an hour <a:saber:851241060553326652>.\nID: ${author.id}`)
	          .setFooter("");
}

async function on_message(message: Discord.Message) {
	try {
		if(message.author.bot) return; // Ignore bots
		if(message.content == "!roulette") {
			if(message.channel.id != bot_spam_id) {
				message.reply(`Must be used in <#${bot_spam_id}>`);
				return;
			}
			if(warned_users.has(message.author.id)) {
				const roll = Math.floor(Math.random() * 6);
				M.log("!roulette", [message.author.id, message.author.tag], roll);
				if(roll == 0) {
					// Send bang message
					const m = {embeds: [make_bang_embed(message.author)]};
					message.channel.send(m);
					member_log_channel.send(m);
					// Setup ban message
					const ban_embed = make_ban_embed(message);
					const log_msg = await member_log_channel.send({embeds: [ban_embed]});
					message.member!.timeout(30 * MINUTE, "Bang")
						.catch((...args: any[]) => {
							critical_error("promise failed for timeout of roulette loser", [message.author.id, message.author.tag]);
							M.error(...args);
							ban_embed.setFooter(ban_embed.footer!.text! + `Error: Timeout failed `);
							log_msg.edit({embeds: [ban_embed]});
						});
				} else {
					const m = {embeds: [make_click_embed(message.author)]};
					await message.channel.send(m);
					await member_log_channel.send(m);
				}
			} else {
				message.reply("Warning: This is __Russian roulette__. Losing will result in a 30 timeout. Proceed at your own risk.");
				warned_users.insert(message.author.id);
			}
		}
	} catch(e) {
		critical_error(e);
		try {
			message.reply("Internal error while handling !roulette");
		} catch(e) {
			critical_error(e);
		}
	}
}

async function on_ready() {
	try {
		const TCCPP = await client.guilds.fetch(TCCPP_ID);
		member_log_channel = (await TCCPP.channels.fetch(member_log_channel_id))! as Discord.TextChannel;
		action_log_channel = (await TCCPP.channels.fetch(action_log_channel_id))! as Discord.TextChannel;
		client.on("messageCreate", on_message);
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_roulette(_client: Discord.Client) {
	try {
		client = _client;
		client.on("ready", on_ready);
	} catch(e) {
		critical_error(e);
	}
}
