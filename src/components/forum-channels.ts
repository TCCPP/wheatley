import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { get_tag, M, SelfClearingSet } from "../utils.js";
import { colors, is_forum_help_thread, MINUTE } from "../common.js";
import { decode_snowflake } from "./snowflake.js"; // todo: eliminate decode_snowflake
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

// TODO: Take into account thread's inactivity setting

const inactive_timeout = 12 * 60 * MINUTE; // 12 hours for a thread that's seen no activity, mark it stale

const cleanup_limit = 400; // how many messages back in the archive to go

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
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

// TODO: Improve initial message, make it more friendly to the eye
// reduce time of initial message
export class ForumChannels extends BotComponent {
    // don't prompt twice within 2 hours - that's just annoying
    readonly possibly_resolved = new SelfClearingSet<string>(2 * 60 * MINUTE);
    readonly timeout_map = new Map<string, NodeJS.Timeout>();
    interval: NodeJS.Timer;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override destroy() {
        super.destroy();
        this.possibly_resolved.destroy();
        clearInterval(this.interval);
        for(const [ _, timeout ] of this.timeout_map) {
            clearTimeout(timeout);
        }
    }

    async forum_cleanup() {
        // TODO: Temporarily turned off
        //M.debug("Running forum cleanup");
        //// Routinely archive threads
        //// Ensure no thread has both the solved and open tag?
        //for(const forum of [ this.wheatley.cpp_help, this.wheatley.c_help ]) {
        //    const open_tag = get_tag(forum, "Open").id;
        //    const solved_tag = get_tag(forum, "Solved").id;
        //    const stale_tag = get_tag(forum, "Stale").id;
        //    M.info("-------------------------->", get_tag(forum, "Stale"));
        //    const threads = await fetch_all_threads_archive_count(forum, cleanup_limit);
        //    M.debug("Cleaning up", threads.size, "threads");
        //    for(const [ _, thread ] of threads) {
        //        assert(thread.parentId);
        //        if(forum_help_channels.has(thread.parentId)) {
        //            await this.misc_checks(thread, open_tag, solved_tag, stale_tag);
        //            await this.check_thread_activity(thread, open_tag, solved_tag, stale_tag);
        //        }
        //    }
        //}
        //M.debug("Finished forum cleanup");
    }

    async prompt_close(thread: Discord.ThreadChannel) {
        this.timeout_map.delete(thread.id);
        const forum = thread.parent;
        assert(forum instanceof Discord.ForumChannel);
        const solved_tag = get_tag(forum, "Solved").id;
        if(thread.appliedTags.includes(solved_tag)) {
            // no action needed - has been marked !solved
        } else {
            M.log("Sending !solved prompt timeout for thread", thread.id, thread.name, thread.url);
            thread.send(`<@${thread.ownerId}> Has your question been resolved? If so, run \`!solved\` :)`);
        }
    }

    async check_thread_activity(
        thread: Discord.ThreadChannel,
        open_tag: string,
        solved_tag: string,
        stale_tag: string
    ) {
        // thread.lastMessageId can be null if there are no messages (possibly and the forum starter has been deleted)
        // if the thread author hasn't sent an initial message it'll mess things up, this needs manual review
        if(thread.lastMessageId == null) {
            this.wheatley.zelis.send(`thread.lastMessageId is null for ${thread.url}`);
            return;
        }
        const now = Date.now();
        const last_message = decode_snowflake(thread.lastMessageId);
        // if the thread is open has been inactive mark it stale
        if(thread.appliedTags.includes(open_tag)
        && !thread.archived
        && now - last_message >= inactive_timeout) {
            M.log("Handling inactive channel", thread.id, thread.name, thread.url);
            //await thread.setArchived(true);
            await thread.send({
                embeds: [
                    create_embed(undefined, colors.color, "This question is being automatically marked as stale.\n"
                        + " If your question has been answered, run `!solved`.\n"
                        + "If your question is not answered feel free to bump the post or re-ask.\n"
                        + "Take a look at `!howto ask` for tips on improving your question.")
                ]
            });
            await thread.setAppliedTags([stale_tag].concat(thread.appliedTags.filter(
                t => ![ open_tag, solved_tag ].includes(t)
            )));
        }
    }

    async misc_checks(thread: Discord.ThreadChannel, open_tag: string, solved_tag: string, stale_tag: string) {
        const status_tags = [ open_tag, solved_tag, stale_tag ];
        // Ensure there is exactly one solved/open/stale tag
        M.debug(thread.appliedTags, status_tags);
        const solved_open_count = thread.appliedTags.filter(tag => status_tags.includes(tag)).length;
        if(solved_open_count != 1) {
            M.log("Setting thread with", solved_open_count, "solved/open/stale tags to have one such tag",
                  thread.id, thread.name, thread.url);
            const { archived } = thread;
            if(archived) await thread.setArchived(false);
            const tag = thread.appliedTags.includes(solved_tag) ? solved_tag : open_tag;
            await thread.setAppliedTags(
                [tag].concat(thread.appliedTags.filter(tag => !status_tags.includes(tag)).slice(0, 4))
            );
            if(archived) await thread.setArchived(true);
        }
        // Cleanup the legacy system: If the thread name starts with [SOLVED], remove it
        if(thread.name.startsWith("[SOLVED]")) {
            M.log("Removing \"[SOLVED]\" from forum thread name", thread.id, thread.name, thread.url);
            const { archived } = thread;
            if(archived) await thread.setArchived(false);
            await thread.setName(thread.name.slice("[SOLVED]".length).trim());
            if(archived) await thread.setArchived(true);
        }
    }

    override async on_ready() {
        //await get_initial_active();
        await this.forum_cleanup();
        // every hour try to cleanup
        this.interval = setInterval(this.forum_cleanup.bind(this), 60 * MINUTE);
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.type == Discord.MessageType.ThreadCreated) return; // ignore message create messages
        const channel = message.channel;
        if(message.id == message.channelId) {
            // forum start message
            assert(channel instanceof Discord.ThreadChannel);
            const thread = channel;
            if(thread.ownerId == this.wheatley.id) { // wheatley threads are either modlogs or thread help threads
                return;
            }
            if(is_forum_help_thread(thread)) {
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const open_tag = get_tag(forum, "Open").id;
                // at most 5 tags
                await thread.setAppliedTags([open_tag].concat(thread.appliedTags.slice(0, 4)));
                await thread.send({
                    embeds: [create_embed(undefined, colors.red, "When your question is answered use **`!solved`** to "
                        + "mark the question as resolved.\n\nRemember to ask __specific questions__, provide "
                        + "__necessary details__, and reduce your question to its __simplest form__. For tips on how "
                        + "to ask a good question run `!howto ask`.")]
                });
            }
        } else {
            if(channel instanceof Discord.ThreadChannel) {
                const thread = channel;
                if(is_forum_help_thread(thread)) {
                    // solved prompt logic
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
                                if(!this.possibly_resolved.has(thread.id)) {
                                    M.debug("Setting !solved prompt timeout for thread", thread.id, thread.name,
                                            thread.url, "based off of", message.url);
                                    this.timeout_map.set(thread.id, setTimeout(async () => {
                                        await this.prompt_close(thread);
                                    }, thank_you_timeout));
                                    this.possibly_resolved.insert(thread.id);
                                    return;
                                }
                            }
                        }
                        // if we reach here, it's a non-thank message
                        // might need to restart the timeout
                        if(this.timeout_map.has(thread.id)) {
                            clearTimeout(this.timeout_map.get(thread.id));
                            this.timeout_map.set(thread.id, setTimeout(async () => {
                                await this.prompt_close(thread);
                            }, thank_you_timeout));
                        }
                    }
                }
            }
        }
    }
}
