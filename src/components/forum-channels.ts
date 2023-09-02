import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { fetch_all_threads_archive_count, get_tag } from "../utils/discord.js";
import { critical_error } from "../utils/debugging-and-logging.js";
import { SelfClearingSet } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { decode_snowflake } from "./snowflake.js"; // todo: eliminate decode_snowflake
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

// TODO: Take into account thread's inactivity setting

const inactive_timeout = 48 * 60 * MINUTE; // 48 hours for a thread that's seen no activity, mark it stale
const solved_archive_timeout = 48 * 60 * MINUTE; // after 48 hours hide solved threads
const stale_rearchive_timeout = 12 * 60 * MINUTE; // after 12 hours hide stale threads

const cleanup_limit = 400; // how many posts back in the archive to go

// if the op says thank you remind them to close the thread after 15 minutes
const thank_you_timeout = 5 * MINUTE;

const thank_you_re = /\b(thanks|thank\s*(?:you|u)|ty|cheers|figured? it out(?!\?))\b/gi;

/*
 * Forum thread handling:
 * - Thread create message
 * - Forum cleanup
 * - Tag cleanup
 * - Has your question been solved prompt
 */

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(msg);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

/**
 * Support for marking threads as solved and other features.
 */
export default class ForumChannels extends BotComponent {
    // TODO: Improve initial message, make it more friendly to the eye
    //       reduce time of initial message

    // don't prompt twice within 2 hours - that's just annoying
    readonly possibly_resolved = new SelfClearingSet<string>(2 * 60 * MINUTE);
    readonly timeout_map = new Map<string, NodeJS.Timeout>();
    interval: NodeJS.Timeout;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    async forum_cleanup() {
        // TODO: Temporarily turned off
        M.debug("Running forum cleanup");
        // Routinely archive threads
        // Ensure no thread has both the solved and open tag?
        for (const forum of [this.wheatley.channels.cpp_help, this.wheatley.channels.c_help]) {
            const open_tag = get_tag(forum, "Open").id;
            const solved_tag = get_tag(forum, "Solved").id;
            const stale_tag = get_tag(forum, "Stale").id;
            const threads = await fetch_all_threads_archive_count(forum, cleanup_limit);
            M.debug("Cleaning up", threads.size, "threads in", forum.name);
            for (const [_, thread] of threads) {
                assert(thread.parentId && thread.parentId == forum.id);
                await this.misc_checks(thread, open_tag, solved_tag, stale_tag);
                await this.check_thread_activity(thread, open_tag, solved_tag, stale_tag);
            }
        }
        M.debug("Finished forum cleanup");
    }

    async prompt_close(thread: Discord.ThreadChannel) {
        this.timeout_map.delete(thread.id);
        const forum = thread.parent;
        assert(forum instanceof Discord.ForumChannel);
        const solved_tag = get_tag(forum, "Solved").id;
        if (thread.appliedTags.includes(solved_tag)) {
            // no action needed - has been marked !solved
        } else {
            M.log("Sending !solved prompt timeout for thread", thread.id, thread.name, thread.url);
            await thread.send(`<@${thread.ownerId}> Has your question been resolved? If so, run \`!solved\` :)`);
        }
    }

    async check_thread_activity(
        thread: Discord.ThreadChannel,
        open_tag: string,
        solved_tag: string,
        stale_tag: string,
    ) {
        // thread.lastMessageId can be null if there are no messages (possibly and the forum starter has been deleted)
        // if the thread author hasn't sent an initial message it'll mess things up, this needs manual review
        if (thread.lastMessageId == null) {
            await this.wheatley.zelis.send(`thread.lastMessageId is null for ${thread.url}`);
            return;
        }
        const now = Date.now();
        const last_message = decode_snowflake(thread.lastMessageId);
        // if the thread is open has been inactive mark it stale
        if (thread.appliedTags.includes(open_tag) && now - last_message >= inactive_timeout) {
            M.log("Marking inactive thread as stale and archiving", thread.id, thread.name, thread.url);
            //await thread.setArchived(true);
            await thread.send({
                embeds: [
                    create_embed(
                        undefined,
                        colors.wheatley,
                        "This question is being automatically marked as stale.\n" +
                            " If your question has been answered, run `!solved`.\n" +
                            "If your question is not answered feel free to bump the post or re-ask.\n" +
                            "Take a look at `!howto ask` for tips on improving your question.",
                    ),
                ],
            });
            await thread.setAppliedTags(
                [stale_tag].concat(thread.appliedTags.filter(t => ![open_tag, solved_tag].includes(t))),
            );
            await thread.setArchived(true, "Automatically archiving: Stale");
        } else if (
            thread.appliedTags.includes(stale_tag) &&
            !thread.archived &&
            now - last_message >= stale_rearchive_timeout
        ) {
            // Ensure stale threads are archived
            M.log("Archiving thread", thread.id, thread.name);
            await thread.setArchived(true, "Automatically archiving: Stale");
        } else if (
            thread.appliedTags.includes(solved_tag) &&
            !thread.archived &&
            now - last_message >= solved_archive_timeout
        ) {
            // if the thread is solved and isn't being talked about anymore, archive it
            M.log("Archiving solved thread", thread.id, thread.name, thread.url);
            await thread.setArchived(true, "Automatically archiving: Solved");
        }
    }

    async misc_checks(thread: Discord.ThreadChannel, open_tag: string, solved_tag: string, stale_tag: string) {
        const status_tags = [open_tag, solved_tag, stale_tag];
        // Ensure there is exactly one solved/open/stale tag
        const status_tag_count = thread.appliedTags.filter(tag => status_tags.includes(tag)).length;
        if (status_tag_count != 1) {
            M.log(
                "Setting thread with",
                status_tag_count,
                "solved/open/stale tags to have one such tag",
                thread.id,
                thread.name,
                thread.url,
            );
            const { archived } = thread;
            if (archived) {
                await thread.setArchived(false);
            }
            const tag = thread.appliedTags.includes(solved_tag) ? solved_tag : open_tag;
            await thread.setAppliedTags(
                [tag].concat(thread.appliedTags.filter(tag => !status_tags.includes(tag)).slice(0, 4)),
            );
            if (archived) {
                await thread.setArchived(true);
            }
        }
        // Cleanup the legacy system: If the thread name starts with [SOLVED], remove it
        if (thread.name.startsWith("[SOLVED]")) {
            M.log('Removing "[SOLVED]" from forum thread name', thread.id, thread.name, thread.url);
            const { archived } = thread;
            if (archived) {
                await thread.setArchived(false);
            }
            await thread.setName(thread.name.slice("[SOLVED]".length).trim());
            if (archived) {
                await thread.setArchived(true);
            }
        }
    }

    override async on_ready() {
        //await get_initial_active();
        await this.forum_cleanup();
        // every hour try to cleanup
        this.interval = setInterval(() => {
            this.forum_cleanup().catch(critical_error);
        }, 60 * MINUTE);
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots and thread create messages
        if (message.author.bot || message.type == Discord.MessageType.ThreadCreated) {
            return;
        }
        const channel = message.channel;
        if (message.id == message.channelId) {
            // forum start message
            assert(channel instanceof Discord.ThreadChannel);
            const thread = channel;
            if (thread.ownerId == this.wheatley.id) {
                // wheatley threads are either modlogs or thread help threads
                return;
            }
            if (this.wheatley.is_forum_help_thread(thread)) {
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const open_tag = get_tag(forum, "Open").id;
                // at most 5 tags
                await thread.setAppliedTags([open_tag].concat(thread.appliedTags.slice(0, 4)));
                await thread.send({
                    embeds: [
                        create_embed(
                            undefined,
                            colors.wheatley,
                            "When your question is answered use **`!solved`** to " +
                                "mark the question as resolved.\n\nRemember to ask __specific questions__, provide " +
                                "__necessary details__, and reduce your question to its __simplest form__. For tips " +
                                "on how to ask a good question run `!howto ask`.",
                        ),
                    ],
                });
            }
        } else {
            if (channel instanceof Discord.ThreadChannel) {
                const thread = channel;
                if (this.wheatley.is_forum_help_thread(thread)) {
                    // solved prompt logic
                    const forum = thread.parent;
                    assert(forum instanceof Discord.ForumChannel);
                    const solved_tag = get_tag(forum, "Solved").id;
                    if (!thread.appliedTags.includes(solved_tag)) {
                        // if this is an unsolved help forum post... check if we need to start or restart a timeout
                        const op = thread.ownerId;
                        assert(op, "Assumption: Can only happen if uncached.");
                        if (message.author.id == op) {
                            const content = message.content.toLowerCase();
                            if (content.match(thank_you_re) != null) {
                                if (!this.possibly_resolved.has(thread.id)) {
                                    M.debug(
                                        "Setting !solved prompt timeout for thread",
                                        thread.id,
                                        thread.name,
                                        thread.url,
                                        "based off of",
                                        message.url,
                                    );
                                    this.timeout_map.set(
                                        thread.id,
                                        setTimeout(() => {
                                            this.prompt_close(thread).catch(critical_error);
                                        }, thank_you_timeout),
                                    );
                                    this.possibly_resolved.insert(thread.id);
                                    return;
                                }
                            }
                        }
                        // if we reach here, it's a non-thank message
                        // might need to restart the timeout
                        if (this.timeout_map.has(thread.id)) {
                            clearTimeout(this.timeout_map.get(thread.id));
                            this.timeout_map.set(
                                thread.id,
                                setTimeout(() => {
                                    this.prompt_close(thread).catch(critical_error);
                                }, thank_you_timeout),
                            );
                        }
                    }
                }
            }
        }
    }
}
