import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { colors, thread_based_channel_ids, thread_based_help_channel_ids } from "./common";

let client: Discord.Client;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.MessageEmbed()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.type == 'THREAD_CREATED') return; // ignore message create messages
        if(thread_based_help_channel_ids.has(message.channel.id)) {
            const thread = await message.startThread({
                name: `Help ${message.member?.displayName}`
            });
            await thread.send({
                content: `<@${message.author.id}> This thread is for your question, use \`!rename <brief description>\` to set the thread's name.\n\nSomeone will surely help soon :smile: \n\nHaving trouble getting an answer? Use \`!howto ask\` for tips on how to ask a programming question. And remember, don't ask to ask just ask your question!`
            });
        }
        if(thread_based_channel_ids.has(message.channel.id)) {
            const s = message.member?.displayName.trim().endsWith("s") ? "" : "s"; // rudimentary
            const thread = await message.startThread({
                name: `${message.member?.displayName}'${s} post`
            });
            await thread.send({
                content: `<@${message.author.id}> This thread is for your post, use \`!rename <brief description>\` to set the thread's name.`
            });
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_thread_based_channels(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
