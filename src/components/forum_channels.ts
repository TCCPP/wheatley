import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, denullify, fetch_forum_channel, get_tag, M } from "../utils";
import { colors, cpp_help_id, c_help_id, forum_help_channels, is_forum_help_thread, MINUTE,
         wheatley_id } from "../common";
import { decode_snowflake } from "./snowflake"; // todo: eliminate decode_snowflake

let client: Discord.Client;

let cpp_help: Discord.ForumChannel;
let c_help: Discord.ForumChannel;

/*
 * Forum thread handling:
 * - Thread create message
 * - Forum cleanup
 */

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
    } catch(e) {
        critical_error(e);
    }
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
        return;
    }
    if(is_forum_help_thread(thread)) { // TODO
        // Somehow it's a problem to send this message too quickly:
        //  Critical error occurred: unhandledRejection DiscordAPIError: Cannot message this thread until after the post
        //  author has sent an initial message. [object Promise]
        // TODO: revisit once api kinks are worked out
        const forum = thread.parent;
        assert(forum instanceof Discord.ForumChannel);
        const open_tag = get_tag(forum, "Open");
        await thread.setAppliedTags([open_tag.id].concat(thread.appliedTags));
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

async function migration1() {
    const now = Date.now();
    // Cleanup shit from before the forum api was solidified:
    //  Remove [SOLVED] from names and just mark old threads as solved
    for(const forum of [cpp_help, c_help]) {
        const solved_tag = get_tag(forum, "Solved");
        const open_tag = get_tag(forum, "Open");
        const all_threads: Discord.ThreadChannel[] = [];
        while(true) {
            const {threads, hasMore} = await forum.threads.fetchActive();
            M.debug("Cleanup: a", threads.size);
            all_threads.push(...threads.map(t => t));
            assert(!hasMore); // todo: temporary
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if(!hasMore) {
                break;
            }
        }
        let earliest = new Date(86400000000000); // year 4707
        while(true) {
            const {threads, hasMore} = await forum.threads.fetchArchived({ before: earliest });
            M.debug("Cleanup: b", threads.size, earliest);
            all_threads.push(...threads.map(t => t));
            earliest = new Date(Math.min(earliest.getTime(), ...threads.map(t => denullify(t.createdAt).getTime())));
            if(!hasMore) {
                break;
            }
        }
        M.info(`Cleanup: Found ${all_threads.length} threads`);
        for(const thread of all_threads) {
            if(thread.name.startsWith("[SOLVED]")) {
                M.debug("Cleanup: [SOLVED] -> Solved tag", thread.name);
                // for some reason thread need to be not archived
                await thread.setArchived(false);
                await thread.setName(thread.name.substring("[SOLVED]".length).trim());
                await thread.setAppliedTags(
                    [solved_tag.id].concat(thread.appliedTags.filter(tag => tag != open_tag.id))
                );
                await thread.setArchived(true);
            } else {
                if(!thread.appliedTags.some(tag => [solved_tag.id, open_tag.id].indexOf(tag) != -1)) { // no tags
                    assert(thread.createdTimestamp);
                    if(now - thread.createdTimestamp <= 60 * MINUTE * 24 * 7) {
                        // default to open
                        M.debug("Cleanup: Adding open tag to recent thread", thread.name);
                        await thread.setArchived(false);
                        await thread.setAppliedTags([open_tag.id].concat(thread.appliedTags));
                        await thread.setArchived(true);
                    } else {
                        // just mark old questions as solved
                        M.debug("Cleanup: Adding solved tag to very old thread", thread.name);
                        await thread.setArchived(false);
                        await thread.setAppliedTags([solved_tag.id].concat(thread.appliedTags));
                        await thread.setArchived(true);
                    }
                }
            }
        }
    }
}

async function migration2() {
    // Put solved/open tags at the beginning
    for(const forum of [cpp_help, c_help]) {
        const solved_tag = get_tag(forum, "Solved");
        const open_tag = get_tag(forum, "Open");
        const all_threads: Discord.ThreadChannel[] = [];
        while(true) {
            const {threads, hasMore} = await forum.threads.fetchActive();
            M.debug("Cleanup: a", threads.size);
            all_threads.push(...threads.map(t => t));
            assert(!hasMore); // todo: temporary
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if(!hasMore) {
                break;
            }
        }
        let earliest = new Date(86400000000000); // year 4707
        while(true) {
            const {threads, hasMore} = await forum.threads.fetchArchived({ before: earliest });
            M.debug("Cleanup: b", threads.size, earliest);
            all_threads.push(...threads.map(t => t));
            earliest = new Date(Math.min(earliest.getTime(), ...threads.map(t => denullify(t.createdAt).getTime())));
            //M.debug("Cleanup: xxx", threads.map(t => t.name))
            if(!hasMore) {
                break;
            }
        }
        for(const thread of all_threads) {
            await thread.setArchived(false);
            await thread.setAppliedTags(
                thread.appliedTags.filter(tag => [solved_tag.id, open_tag.id].indexOf(tag) != -1)
                    .concat(
                        thread.appliedTags.filter(tag => [solved_tag.id, open_tag.id].indexOf(tag) == -1)
                    )
            );
            await thread.setArchived(true);
        }
    }
}

async function forum_cleanup() {
    M.info("Running forum cleanup");
    const now = Date.now();
    // Routinely archive threads
    // Ensure no thread has both the solved and open tag
    for(const forum of [cpp_help, c_help]) {
        const active_threads: Discord.ThreadChannel[] = [];
        while(true) {
            const {threads, hasMore} = await forum.threads.fetchActive();
            if(!hasMore) {
                break;
            }
            active_threads.push(...threads.map(t => t));
        }
        const solved_archive_timeout = 24 * 60 * MINUTE; // 24 hours for a solved thread that's reopened
        const inactive_timeout = 48 * 60 * MINUTE; // 48 hours for a channel that's just seen no activity

        active_threads.map(async thread => {
            assert(thread.parentId);
            if(forum_help_channels.has(thread.parentId)) { // TODO
                //M.debug(thread);
                assert(thread.createdTimestamp);
                assert(thread.lastMessageId);
                if(thread.name.startsWith("[SOLVED]")
                && now - thread.createdTimestamp >= solved_archive_timeout
                && now - decode_snowflake(thread.lastMessageId) >= solved_archive_timeout) {
                    M.log("Archiving solved channel", [thread.id, thread.name]);
                    thread.setArchived(true);
                } else if((
                    now - thread.createdTimestamp >= inactive_timeout
                        && now - decode_snowflake(thread.lastMessageId) >= inactive_timeout
                ) || await last_message_is_shit(thread, thread.lastMessageId)) {
                    M.log("Archiving inactive channel", [thread.id, thread.name]);
                    assert(thread.ownerId);
                    assert(thread.messageCount);
                    await thread.send({
                        content: thread.messageCount > 1 ? undefined : `<@${thread.ownerId}>`,
                        embeds: [
                            create_embed(undefined, colors.color, "This question thread is being automatically closed."
                                + " If your question is not answered feel free to bump the post or re-ask. Take a look"
                                + " at `!howto ask` for tips on improving your question.")
                        ]
                    });
                    await thread.setArchived(true);
                }
            }
        });
    }
}

async function on_ready() {
    try {
        cpp_help = await fetch_forum_channel(cpp_help_id);
        c_help = await fetch_forum_channel(c_help_id);
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
        await migration1();
        await migration2();
        await forum_cleanup();
        // every hour try to cleanup
        setInterval(forum_cleanup, 60 * MINUTE);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_forum_channels(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
