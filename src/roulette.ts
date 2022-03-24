import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingSet } from "./utils";
import { action_log_channel_id, member_log_channel_id, MINUTE, TCCPP_ID } from "./common";

let client: Discord.Client;

const warned_users = new SelfClearingSet<string>(60 * MINUTE, 60 * MINUTE);

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
	          .setDescription(`BANG. <@${author.id}> is banned <a:saber:851241060553326652>`);
}
function make_ban_embed(author: Discord.User) {
	return new Discord.MessageEmbed()
	          .setColor(red)
	          .setDescription(`BANG. <@${author.id}> lost roulette and is being banned <a:saber:851241060553326652>. Will be automatically unbanned in half an hour. ID: ${author.id}`)
			  .setFooter("");
}

async function on_message(message: Discord.Message) {
	try {
		if(message.author.bot) return; // Ignore bots
		if(message.content == "!roulette") {
			if(warned_users.has(message.author.id)) {
				const roll = Math.floor(Math.random() * 6);
				M.log("!roulette", [message.author.id, message.author.username], roll);
				if(roll == 0) {
					const m = {embeds: [make_bang_embed(message.author)]};
					message.channel.send(m);
					member_log_channel.send(m);
					const e = make_ban_embed(message.author);
					const log_msg = await action_log_channel.send({embeds: [e]});
					message.author.send("Bang. Tough luck.\n"
					    + "Your account will be unbanned in half an hour, reach out to jr-#6677 if there are issues.")
						.catch((...args: any[]) => {
							critical_error("promise failed for dm to roulette loser", message.author);
							M.error(...args);
							e.setFooter(e.footer + `Note: Dm failed `);
							log_msg.edit({embeds: [e]});
						})
						.finally(() => {
							message.guild?.members.ban(message.author.id)
								.catch((...args: any[]) => {
									critical_error("promise failed for ban of roulette loser", message.author);
									M.error(...args);
									e.setFooter(e.footer + `Error: Ban failed `);
									log_msg.edit({embeds: [e]});
								})
								.finally(() => {
									M.log("Timer set");
									setTimeout(() => {
										M.log("Unbanning", message.author);
										message.guild?.members.unban(message.author.id);
										e.setFooter(e.footer + `Note: Now unbanned `);
										log_msg.edit({embeds: [e]});
									}, 30 * MINUTE);
								});
						});
				} else {
					const m = {embeds: [make_click_embed(message.author)]};
					await message.channel.send(m);
					await member_log_channel.send(m);
				}
			} else {
				message.reply("Warning: This will actually ban you. Proceed at your own risk.");
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
