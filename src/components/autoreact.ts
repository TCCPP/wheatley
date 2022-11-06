import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, delay, M } from "../utils";
import { introductions_channel_id, memes_channel_id, MINUTE, server_suggestions_channel_id, TCCPP_ID } from "../common";

let client: Discord.Client;

async function is_new_member(message: Discord.Message) {
    let member: Discord.GuildMember;
    if(message.member == null) {
        try {
            member = await message.guild!.members.fetch(message.author.id);
        } catch(error) {
            M.warn("failed to get user", message.author.id);
            return false;
        }
    } else {
        member = message.member;
    }
    assert(member.joinedTimestamp != null);
    return (Date.now() - member.joinedTimestamp) <= 4 * 24 * 60 * MINUTE;
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.id == client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
        if(message.channel.id == introductions_channel_id) {
            if(message.member == null) M.warn("Why??", message); // TODO: Ping zelis?
            if(await is_new_member(message)) {
                await delay(1 * MINUTE);
                M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                await message.react("👋");
            }
        } else if(message.channel.id == memes_channel_id && message.attachments.size > 0) {
            M.log("adding star reaction", message.author.tag, message.author.id, message.url);
            await message.react("⭐");
        } else if(message.channel.id == server_suggestions_channel_id) {
            M.log("adding server suggestion reactions", message.author.tag, message.author.id, message.url);
            await message.react("👍");
            await message.react("👎");
        }
    } catch(e) {
        critical_error(e);
    }
}

async function catch_up() {
    const TCCPP = await client.guilds.fetch(TCCPP_ID);
    const introductions_channel = await TCCPP.channels.fetch(introductions_channel_id);
    assert(introductions_channel);
    assert(introductions_channel.type == Discord.ChannelType.GuildText);
    const messages = await introductions_channel.messages.fetch({ limit: 100, cache: false });
    for(const [ _, message ] of messages) {
        if(await is_new_member(message)) {
            M.log("Waving to new user", message.author.tag, message.author.id, message.url);
            message.react("👋");
        }
    }
    M.log("finished catching up on introduction messages");
}

async function on_ready() {
    try {
        catch_up();
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_autoreact(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
        client.on("messageCreate", on_message);
    } catch(e) {
        critical_error(e);
    }
}
