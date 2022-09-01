import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { colors, thread_based_channel_ids, thread_based_help_channel_ids, wheatley_id } from "../common";

let client: Discord.Client;

// TODO: This is temporary until discordjs supports forums
const forum_channels = new Set([
    "1013107104678162544", // cpp-help
    "1013104018739974194", // c-help
    "1014328785685979136", // projects
]);
const forum_help_channels = new Set([
    "1013107104678162544", // cpp-help
    "1013104018739974194", // c-help
]);

function is_forum_thread(thread: Discord.ThreadChannel) {
    return thread.parentId && forum_channels.has(thread.parentId);
}

function is_forum_help_thread(thread: Discord.ThreadChannel) {
    return thread.parentId && forum_help_channels.has(thread.parentId);
}

async function get_owner(thread: Discord.ThreadChannel) {
    if(is_forum_thread(thread)) {
        return thread.ownerId!/*TODO*/
    } else {
        return thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId!/*TODO*/
            : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
    }
}

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
                content: `<@${message.author.id}> This thread is for your question, use \`!rename <brief description>\` to set the thread's name. When your question is answered use \`!solved\` to mark the question as resolved.\n\nSomeone will surely help soon :smile: \n\nHaving trouble getting an answer? Use \`!howto ask\` for tips on how to ask a programming question. And remember, don't ask to ask just ask your question!`,
                allowedMentions: { parse: [] }
            });
            await thread.members.add(message.author);
            await thread.leave();
        }
        if(thread_based_channel_ids.has(message.channel.id)) {
            const s = message.member?.displayName.trim().endsWith("s") ? "" : "s"; // rudimentary
            const thread = await message.startThread({
                name: `${message.member?.displayName}'${s} post`
            });
            await thread.send({
                content: `<@${message.author.id}> This thread is for your post, use \`!rename <brief description>\` to set the thread's name.`,
                allowedMentions: { parse: [] }
            });
            await thread.members.add(message.author);
            await thread.leave();
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
        return;
    }
    if(is_forum_help_thread(thread)) {
        await thread.send({
            embeds: [create_embed(undefined, colors.red, `When your question is answered use \`!solved\` to mark the question as resolved.\n\nRemember to ask specific questions, provide necessary details, and reduce your question to its simplest form. For more information use \`!howto ask\`.`)]
        });
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
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
