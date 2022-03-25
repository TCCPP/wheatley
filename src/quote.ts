import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { message_log_channel_id, MINUTE, TCCPP_ID } from "./common";
import { decode_snowflake, forge_snowflake } from "./snowflake";

let client: Discord.Client;

let TCCPP : Discord.Guild;
let message_log_channel : Discord.TextChannel;

// https://discord.com/channels/331718482485837825/802541516655951892/877257002584252426
//                              guild              channel            message
const quote_command_re = /^!(quoteb?)\s*https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i;

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

function is_image_link_embed(embed: Discord.MessageEmbed) {
	for(let key in embed) {
		if(["type", "url", "thumbnail"].indexOf(key) === -1) {
			const value = (embed as any)[key];
			if(!(value === null || (Array.isArray(value) && value.length == 0))) {
				return false;
			}
		}
	}
	return true;
}

async function make_quote(messages: Discord.Message[], requested_by: Discord.GuildMember) {
	assert(messages.length >= 1);
	const head = messages[0];
	assert(head.content != null);
	assert(head.author != null);
	const contents = messages.map(m => m.content).join("\n");
	let embed = new Discord.MessageEmbed()
	           .setColor(color)
	           .setAuthor(`${await get_display_name(head)}`, head.author.displayAvatarURL())
	           .setDescription(contents + `\n\nFrom <#${head.channel.id}> [[Jump to message]](${head.url})`)
	           .setTimestamp(head.createdAt)
	           .setFooter(`Quoted by ${requested_by.displayName}`, requested_by.user.displayAvatarURL());
	let images = messages.map(message => [
		...message.attachments.filter(a => a.contentType?.indexOf("image") == 0).map(a => a.url),
		...message.embeds.filter(is_image_link_embed).map(e => e.url!)
	]).flat();
	let other_embeds = messages.map(message => message.embeds.filter(e => !is_image_link_embed(e))).flat();
	let image_embeds: Discord.MessageEmbed[] = [];
	if(images.length > 0) {
		embed.setImage(images[0]);
		for(let image of images.slice(1)) {
			image_embeds.push(new Discord.MessageEmbed({
				image: {
					url: image
				}
			}));
		}
	}
	return [embed, ...image_embeds, ...other_embeds];
}

function index_of_first_not_satisfying<T>(arr: T[], fn: (x: T) => boolean) {
	for(let i = 0; i < arr.length; i++) {
		if(!fn(arr[i])) {
			return i;
		}
	}
	return -1;
}

async function do_quote(message: Discord.Message, channel_id: string, message_id: string, block: boolean) {
	let channel = await TCCPP.channels.fetch(channel_id);
	if(channel instanceof Discord.TextChannel
	|| channel instanceof Discord.ThreadChannel
	|| channel instanceof Discord.NewsChannel) {
		let messages: Discord.Message[] = [];
		if(block) {
			let fetched_messages = (await channel.messages.fetch({
				after: forge_snowflake(decode_snowflake(message_id) - 1),
				limit: 50
			})).map(m => m).reverse();
			const start_time = fetched_messages.length > 0 ? fetched_messages[0].createdTimestamp : undefined;
			let end = index_of_first_not_satisfying(fetched_messages,
				  m => m.author.id == fetched_messages[0].author.id && m.createdTimestamp - start_time! <= 60 * MINUTE);
			messages = fetched_messages.slice(0, end == -1 ? fetched_messages.length : end);
		} else {
			let quote_message = await channel.messages.fetch(message_id);
			assert(message.member != null);
			messages = [quote_message];
		}
		assert(messages.length >= 1);
		let quote_embeds = await make_quote(messages, message.member!);
		await message.channel.send({ embeds: quote_embeds });
		// log
		// TODO: Can probably improve how this is done. Figure out later.
		message_log_channel.send({
			content: `Message quoted`
					+ `\nIn <#${message.channel.id}> ${message.url}`
					+ `\nFrom <#${channel_id}> ${messages[0].url}`
					+ `\nBy ${message.author.tag} ${message.author.id}`,
			embeds: quote_embeds
		});
		// delete request
		message.delete();
	} else {
		message.reply("Error: Channel not a text channel.");
	}
}

async function on_message(message: Discord.Message) {
	try {
		if(message.author.id == client.user!.id) return; // Ignore self
		if(message.author.bot) return; // Ignore bots
		//if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
		let match = message.content.match(quote_command_re);
		if(match != null) {
			M.log("got quote command", message.content, match);
			assert(match.length == 5);
			let [op, guild_id, channel_id, message_id] = match.slice(1);
			if(guild_id == TCCPP_ID) {
				await do_quote(message, channel_id, message_id, op == "quoteb");
			}
		} else if(message.content.trim() == "!quote" || message.content.trim() == "!quoteb") {
			if(message.type == "REPLY") {
				let reply = await message.fetchReference();
				await do_quote(message, reply.channel.id, reply.id, message.content.trim() == "!quoteb");
			} else {
				message.channel.send("`!quote <url>` or `!quote` while replying. !quoteb can be used to quote a continuous block of messages from a user");
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
