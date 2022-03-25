import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "./utils";
import { action_log_channel_id, everyone_role_id, member_log_channel_id, MINUTE, TCCPP_ID } from "./common";

let client: Discord.Client;

const warned_users = new SelfClearingSet<string>(60 * MINUTE);
const user_roles_map = new SelfClearingMap<string, string[]>(24 * 60 * MINUTE);

let member_log_channel : Discord.TextChannel;
let action_log_channel : Discord.TextChannel;

const green = 0x31ea6c;
const red = 0xed2d2d;

function get_roles(member: Discord.GuildMember | null) {
	return member?.roles.cache.map(r => r.id).filter(id => id != everyone_role_id);
}

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

function make_ban_embed(message: Discord.Message) {
	const author = message.author;
	return new Discord.MessageEmbed()
	          .setColor(red)
	          .setDescription(`BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ) [roulette](${message.url}) and is being banned <a:saber:851241060553326652>.\n`
	                        + `User will automatically be unbanned in half an hour. ID: ${author.id}\n`
	                        + `Roles: ${get_roles(message.member)?.map(id => `<@&${id}>`).join(" ")}\n`)
	          .setFooter("");
}

async function on_message(message: Discord.Message) {
	try {
		if(message.author.bot) return; // Ignore bots
		if(message.content == "!roulette") {
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
					const log_msg = await action_log_channel.send({embeds: [ban_embed]});
					// cache roles
					const roles = get_roles(message.member);
					assert(roles);
					// DM + Ban
					message.author.send("Bang. Tough luck.\n"
					    + "Your account will be unbanned in half an hour, reach out to jr-#6677 if there are issues. Invite url: <https://discord.gg/tccpp>.")
						.catch((e: Discord.DiscordAPIError, ...args: any[]) => {
							if(e.code == 50007) {
								M.info("Unable to DM user", [message.author.id, message.author.tag]);
								ban_embed.setFooter(ban_embed.footer!.text! + `Note: Unable to DM `);
								log_msg.edit({embeds: [ban_embed]});
							} else {
								critical_error("promise failed for dm to roulette loser", [message.author.id, message.author.tag]);
								M.error(e, ...args);
								ban_embed.setFooter(ban_embed.footer!.text! + `Note: Dm failed `);
								log_msg.edit({embeds: [ban_embed]});
							}
						})
						.finally(() => {
							message.guild?.members.ban(message.author.id)
								.catch((...args: any[]) => {
									critical_error("promise failed for ban of roulette loser", [message.author.id, message.author.tag]);
									M.error(...args);
									ban_embed.setFooter(ban_embed.footer!.text! + `Error: Ban failed `);
									log_msg.edit({embeds: [ban_embed]});
								})
								.then(() => {
									M.log("Timer set");
									if(user_roles_map.has(message.author.id)) {
										critical_error("user already in user_roles_map");
									}
									user_roles_map.set(message.author.id, roles);
									setTimeout(() => {
										M.log("Unbanning", [message.author.id, message.author.tag]);
										message.guild?.members.unban(message.author.id);
										ban_embed.setFooter(ban_embed.footer!.text! + `Note: Now unbanned `);
										log_msg.edit({embeds: [ban_embed]});
									}, 30 * MINUTE);
								});
						});
				} else {
					const m = {embeds: [make_click_embed(message.author)]};
					await message.channel.send(m);
					await member_log_channel.send(m);
				}
			} else {
				message.reply("Warning: This is __Russian__ roulette. Losing will result in a 30 minute ban. Proceed at your own risk.");
				warned_users.insert(message.author.id);
			}
		}
		if(message.content == "!xxxx") {
			message.reply({embeds: [
				new Discord.MessageEmbed()
					.setColor(red)
					.setDescription(`Roles: ${get_roles(message.member)?.map(id => `<@&${id}>`).join(" ")}\n`)
			]});
			M.info(message.member?.roles.cache);
			M.info(get_roles(message.member));
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

async function on_join(member: Discord.GuildMember) {
	try {
		if(user_roles_map.has(member.id)) {
			const roles = user_roles_map.get(member.id);
			user_roles_map.remove(member.id);
			M.debug("on_join giving roles back", [member.id, member.user.tag], roles);
			for(const role of roles) {
				try {
					await member.roles.add(role, "restore role lost during !roulette");
				} catch(e) {
					if(e instanceof Discord.DiscordAPIError && e.code == 50013) {
						// nothing needed
					} else {
						critical_error(e);
					}
				}
			}
		}
	} catch(e) {
		critical_error(e);
	}
}

async function on_ready() {
	try {
		const TCCPP = await client.guilds.fetch(TCCPP_ID);
		member_log_channel = (await TCCPP.channels.fetch(member_log_channel_id))! as Discord.TextChannel;
		action_log_channel = (await TCCPP.channels.fetch(action_log_channel_id))! as Discord.TextChannel;
		client.on("messageCreate", on_message);
		client.on("guildMemberAdd", on_join);
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
