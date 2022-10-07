import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, fetch_all_threads, fetch_forum_channel, get_tag, M, SelfClearingSet } from "../utils";
import { colors, cpp_help_id, c_help_id, forum_help_channels, is_forum_help_thread, MINUTE,
         wheatley_id } from "../common";
import { decode_snowflake } from "./snowflake"; // todo: eliminate decode_snowflake

let client: Discord.Client;

let cpp_help: Discord.ForumChannel;
let c_help: Discord.ForumChannel;

const solved_archive_timeout = 12 * 60 * MINUTE; // 12 hours for a solved thread that's reopened
const inactive_timeout = 12 * 60 * MINUTE; // 12 hours for a thread that's seen no activity, archive
const resolution_timeout = 12 * 60 * MINUTE; // after another 12 hours, open -> solved

const cleanup_limit = 5 * (24 * 60 * MINUTE); // how far back to search - 5 days

// if a channel hasn't had activity in 2 hours prompt to ask a better question ?
const message_inactivity_threshold = 2 * 60 * MINUTE;
// if the op says thank you remind them to close the thread after 15 minutes
const thank_you_timeout = 5 * MINUTE;

const thank_you_re = /\b(thanks|thank\s*you|ty|cheers)\b/gi;
// was able to figure it out


/*
 * Forum thread handling:
 * - Thread create message
 * - Forum cleanup
 * - Tag cleanup
 * - Has your question been solved prompt
 */

// don't prompt twice within 2 hours - that's just annoying
const possibly_resolved = new SelfClearingSet<string>(2 * 60 * MINUTE);
const timeout_map = new Map<string, NodeJS.Timeout>();

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

async function prompt_close(thread: Discord.ThreadChannel) {
    timeout_map.delete(thread.id);
    const forum = thread.parent;
    assert(forum instanceof Discord.ForumChannel);
    const solved_tag = get_tag(forum, "Solved").id;
    if(thread.appliedTags.includes(solved_tag)) {
        // no action needed - has been marked !solved
    } else {
        M.debug("Sending !solved prompt timeout for thread", [thread.name]);
        thread.send(`<@${thread.ownerId}> Has your question been resolved? If so, run \`!solved\` :)`);
    }
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.type == Discord.MessageType.ThreadCreated) return; // ignore message create messages
        const channel = message.channel;
        if(channel instanceof Discord.ThreadChannel) {
            const thread = channel;
            if(is_forum_help_thread(thread)) {
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const solved_tag = get_tag(forum, "Solved").id;
                if(!thread.appliedTags.includes(solved_tag)) {
                    // if this is an unsolved help forum post... check if we need to start or restart a timeout
                    const op = thread.ownerId;
                    assert(op, "Assumption: Can only happen if uncached.");
                    if(message.author.id == op) {
                        const content = message.content.toLowerCase();
                        if(content.match(thank_you_re) != null) {
                            /*if(timeouts.has(thread.id)) {
                                // pass
                            } else {
                                timeouts.set(thread.id, setTimeout(() => {
                                }, thank_you_threshold));
                            }*/
                            if(!possibly_resolved.has(thread.id)) {
                                M.debug("Setting !solved prompt timeout for thread", [thread.name], "based off of",
                                        [content]);
                                setTimeout(async () => {
                                    await prompt_close(thread);
                                }, thank_you_timeout);
                                possibly_resolved.insert(thread.id);
                                return;
                            }
                        }
                    }
                    // if we reach here, it's a non-thank message
                    // might need to restart the timeout
                    if(timeout_map.has(thread.id)) {
                        M.debug("Restarting !solved prompt timeout for thread", [thread.name]);
                        clearTimeout(timeout_map.get(thread.id));
                        setTimeout(async () => {
                            await prompt_close(thread);
                        }, thank_you_timeout);
                    }
                }
            }
        }
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
        const open_tag = get_tag(forum, "Open").id;
        await thread.setAppliedTags([open_tag].concat(thread.appliedTags));
        setTimeout(async () => {
            await thread.send({
                embeds: [create_embed(undefined, colors.red, "When your question is answered use **`!solved`** to mark "
                    + "the question as resolved.\n\nRemember to ask specific questions, provide necessary details, and "
                    + "reduce your question to its simplest form. For more information use `!howto ask`.")]
            });
        }, 5 * 1000);
    }
}

async function check_thread_activity(thread: Discord.ThreadChannel, solved_tag: string) {
    assert(thread.lastMessageId);
    const now = Date.now();
    const last_message = decode_snowflake(thread.lastMessageId);
    if(thread.appliedTags.includes(solved_tag) && !thread.archived && now - last_message >= solved_archive_timeout) {
        M.log("Archiving solved channel", [thread.name]);
        thread.setArchived(true);
    } else if(!thread.appliedTags.includes(solved_tag) && !thread.archived && now - last_message >= inactive_timeout) {
        M.log("Archiving inactive channel", [thread.name]);
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
    } else if(!thread.appliedTags.includes(solved_tag) && thread.archived && now - last_message >= resolution_timeout) {
        M.log("Resolving channel", [thread.name]);
        await thread.setArchived(false);
        assert(thread.messageCount);
        await thread.send({
            content: thread.messageCount > 1 ? undefined : `<@${thread.ownerId}>`,
            embeds: [
                create_embed(undefined, colors.color, "This question thread is being automatically marked as solved.")
            ]
        });
        await thread.setArchived(true);
    }
}

/*async function deep_clean() {
    const now = Date.now();
    // Catch up on anything that happened when the bot was offline
    // - Archive inactive threads / mark really old threads mark old threads as solved
    // - Ensure there is exactly one solved/open tag
    // - Ensure the solved/open tag is at the beginning
    for(const forum of [cpp_help, c_help]) {
        const solved_tag = get_tag(forum, "Solved").id;
        const open_tag = get_tag(forum, "Open").id;
        const all_threads = (await fetch_all_threads(forum)).map((t, _) => t);
        if(all_threads.length > 1000) { // TODO
            critical_error("You should do this better this");
        }
        M.info(`Deep clean: Found ${all_threads.length} threads`);
        for(const thread of all_threads) {
            // - Ensure there is exactly one solved/open tag
            if(thread.appliedTags.filter(tag => [solved_tag, open_tag].includes(tag)).length != 1) {
                await thread.setArchived(false);
                await thread.setAppliedTags(
                    [solved_tag].concat(thread.appliedTags.filter(tag => ![solved_tag, open_tag].includes(tag)))
                );
                await thread.setArchived(true);
            }
            // - Ensure the solved/open tag is at the beginning
            // We know thread.appliedTags.length >= 1 by now
            else if(!(thread.appliedTags[0] == solved_tag || thread.appliedTags[0] == open_tag)) {
                await thread.setArchived(false);
                await thread.setAppliedTags(
                    [solved_tag].concat(thread.appliedTags.filter(tag => ![solved_tag, open_tag].includes(tag)))
                );
                await thread.setArchived(true);
            }
            // - Archive inactive threads / mark really old threads Mark old threads as solved
            await check_thread_activity(thread, solved_tag);
        }
    }
}*/

async function forum_cleanup() {
    M.info("Running forum cleanup");
    // Routinely archive threads
    // Ensure no thread has both the solved and open tag?
    for(const forum of [cpp_help, c_help]) {
        const solved_tag = get_tag(forum, "Solved").id;
        (await fetch_all_threads(forum, cleanup_limit)).map(async thread => {
            assert(thread.parentId);
            if(forum_help_channels.has(thread.parentId)) {
                //M.debug(thread);
                await check_thread_activity(thread, solved_tag);
            }
        });
    }
}

/*async function get_initial_active() {
    for(const forum of [cpp_help, c_help]) {

    }
}*/

async function on_ready() {
    try {
        cpp_help = await fetch_forum_channel(cpp_help_id);
        c_help = await fetch_forum_channel(c_help_id);
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
        //await get_initial_active();
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
