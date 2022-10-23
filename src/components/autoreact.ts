import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { introductions_channel_id, MINUTE, TCCPP_ID } from "../common";

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
            if(message.member == null) M.warn("Why??", message);
            if(await is_new_member(message)) {
                setTimeout(() => {
                    message.react("👋");
                }, 1 * MINUTE);
            }
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
    for(const [_, message] of messages) {
        if(await is_new_member(message)) {
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
