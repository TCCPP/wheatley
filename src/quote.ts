import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { message_log_channel_id, TCCPP_ID } from "./common";

let client: Discord.Client;

let TCCPP : Discord.Guild;
let message_log_channel : Discord.TextChannel;

// https://discord.com/channels/331718482485837825/802541516655951892/877257002584252426
//                              guild              channel            message
const quote_command_re = /^!quote\s*https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i;

let color = 0x7E78FE; //0xA931FF;

async function get_display_name(thing: Discord.Message | Discord.User): Promise<string> { // TODO: Redundant with server_suggestion_tracker
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

async function make_quote(message: Discord.Message, requested_by: Discord.GuildMember) {
	assert(message.content != null);
	assert(message.author != null);
	let embed = new Discord.MessageEmbed()
	           .setColor(color)
	           .setAuthor(`${await get_display_name(message)}`, message.author.displayAvatarURL())
	           .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
	           .setTimestamp(message.createdAt)
	           .setFooter(`Quoted by ${requested_by.displayName}`, requested_by.user.displayAvatarURL());
	if(message.attachments.size > 0) {
		let image = message.attachments.find(a => a.contentType?.indexOf("image") == 0);
		if(image) {
			embed.setImage(image.url);
		}
	}
	return embed;
}

async function on_message(message: Discord.Message) {
	try {
		if(message.author.id == client.user!.id) return; // Ignore self
		if(message.author.bot) return; // Ignore bots
		//if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
		let match = message.content.match(quote_command_re);
		if(match != null) {
			M.log("got quote command", message.content, match);
			assert(match.length == 4);
			let [guild_id, channel_id, message_id] = match.slice(1);
			if(guild_id == TCCPP_ID) {
				let channel = await TCCPP.channels.fetch(channel_id);
				if(channel instanceof Discord.TextChannel
				|| channel instanceof Discord.ThreadChannel) {
					let quote_message = await channel.messages.fetch(message_id);
					assert(message.member != null);
					let quote = await make_quote(quote_message, message.member!);
					await message.channel.send({ embeds: [ quote ] });
					// log
					// TODO: Can probably improve how this is done. Figure out later.
					message_log_channel.send({
						content: `Message quoted`
						       + `\nIn <#${message.channel.id}> ${message.url}`
							   + `\nFrom <#${channel_id}> ${quote_message.url}`
							   + `\nBy ${message.author.tag} ${message.author.id}`,
						embeds: [ quote ]
					});
					// delete request
					message.delete();
				} else {
					message.reply("Error: Channel not a text channel.");
				}
			}
		}
	} catch(e) {
		critical_error(e);
		try {
			message.reply("Internal error");
		} catch(e) {
			critical_error(e);
		}
	}
}

async function on_ready() {
	try {
		TCCPP = await client.guilds.fetch(TCCPP_ID);
		message_log_channel = (await TCCPP.channels.fetch(message_log_channel_id))! as Discord.TextChannel;
		client.on("messageCreate", on_message);
	} catch(e) {
		critical_error(e);
	}
}

export async function setup_quote(_client: Discord.Client) {
	try {
		client = _client;
		client.on("ready", on_ready);
	} catch(e) {
		critical_error(e);
	}
}
