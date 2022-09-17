import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { colors, forum_help_channels, is_forum_help_thread, MINUTE, TCCPP_ID, thread_based_channel_ids,
         thread_based_help_channel_ids, wheatley_id } from "../common";
import { decode_snowflake } from "./snowflake";

let client: Discord.Client;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
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
        if(message.type == Discord.MessageType.ThreadCreated) return; // ignore message create messages
        if(thread_based_help_channel_ids.has(message.channel.id)) {
            const thread = await message.startThread({
                name: `Help ${message.member?.displayName}`
            });
            await thread.send({
                content: `<@${message.author.id}> This thread is for your question, use \`!rename <brief `
                    + "description>` to set the thread's name. When your question is answered use `!solved` to mark "
                    + "the question as resolved.\n\nSomeone will surely help soon :smile: \n\nHaving trouble getting "
                    + "an answer? Use `!howto ask` for tips on how to ask a programming question. And remember, "
                    + "don't ask to ask just ask your question!",
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
                content: `<@${message.author.id}> This thread is for your post, use \`!rename <brief description>\` to `
                    + "set the thread's name.",
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
        // Somehow it's a problem to send this message too quickly:
        //  Critical error occurred: unhandledRejection DiscordAPIError: Cannot message this thread until after the post
        //  author has sent an initial message. [object Promise]
        // TODO: revisit once api kinks are worked out
        setTimeout(async () => {
            await thread.send({
                embeds: [create_embed(undefined, colors.red, "When your question is answered use `!solved` to mark "
                    + "the question as resolved.\n\nRemember to ask specific questions, provide necessary details, and "
                    + "reduce your question to its simplest form. For more information use `!howto ask`.")]
            });
        }, 5 * 1000);
    }
}

// cleanup my mistake during development....
async function last_message_is_shit(thread: Discord.ThreadChannel, last: string) {
    return false;
    const msg = await thread.messages.fetch(last);
    if(msg.author.id == wheatley_id) {
        return true;
    }
    return false;
}

async function forum_cleanup() {
    const TCCPP = await client.guilds.fetch(TCCPP_ID);
    const {threads, hasMore} = await TCCPP.channels.fetchActiveThreads();
    assert(!hasMore);
    const now = Date.now();
    const cleanup_threshold = 2 * 60 * MINUTE; // 2 hours for a solved thread that's reopened
    const close_threshold = 24 * 60 * MINUTE; // 24 hours for a channel that's just seen no activity
    threads.map(async thread => {
        assert(thread.parentId);
        if(forum_help_channels.has(thread.parentId)) {
            //M.debug(thread);
            assert(thread.createdTimestamp);
            assert(thread.lastMessageId);
            if(thread.name.startsWith("[SOLVED]")
            && now - thread.createdTimestamp >= cleanup_threshold
            && now - decode_snowflake(thread.lastMessageId) >= cleanup_threshold) {
                M.log("Archiving solved channel", [thread.id, thread.name]);
                thread.setArchived(true);
            } else if((
                now - thread.createdTimestamp >= close_threshold
                    && now - decode_snowflake(thread.lastMessageId) >= close_threshold
            ) || await last_message_is_shit(thread, thread.lastMessageId)) {
                M.log("Archiving inactive channel", [thread.id, thread.name]);
                assert(thread.ownerId);
                assert(thread.messageCount);
                await thread.send({
                    content: thread.messageCount > 1 ? null : `<@${thread.ownerId}>`,
                    embeds: [
                        create_embed(undefined, colors.color, "This question thread is being automatically closed. If "
                            + "your question is not answered feel free to bump the post or re-ask. Take a look at "
                            + "`!howto ask` for tips on improving your question.")
                    ]
                });
                await thread.setArchived(true);
            }
        }
    });
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
        forum_cleanup();
        // every hour try to cleanup
        setInterval(forum_cleanup, 60 * MINUTE);
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
