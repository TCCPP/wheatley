import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { xxh3 } from "../utils/strings.js";
import { departialize } from "../utils/discord.js";
import { critical_error } from "../utils/debugging-and-logging.js";
import { KeyedMutexSet, SelfClearingSet } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";
import { forge_snowflake } from "./snowflake.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

export const TRACKER_START_TIME = 1625112000000; // Thu Jul 01 2021 00:00:00 GMT-0400 (Eastern Daylight Time)
// export const TRACKER_START_TIME = 1630468800000; // Wed Sep 01 2021 00:00:00 GMT-0400 (Eastern Daylight Time)
// export const TRACKER_START_TIME = 1636693200000; // debug: Fri Nov 12 2021 00:00:00 GMT-0500 (Eastern Standard Time)

const resolution_reactions = ["🟢", "🔴", "🟡", "🚫"];
const resolution_reactions_set = new Set(resolution_reactions);
const vote_reaction_set = new Set(["👍", "👎"]);

export type suggestion_entry = {
    suggestion: string;
    status_message: string; // dashboard snowflake
    hash: string; // to check if message is updated, currently using xxh3 (64-bit hash)
    up: number;
    down: number;
    maybe: number;
};

const color = 0x7e78fe; //0xA931FF;

type reaction = {
    user: Discord.User;
    emoji: Discord.Emoji;
};

/**
 * Provides a dashboard for server suggestions.
 */
export default class ServerSuggestionTracker extends BotComponent {
    recovering = true;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    // utilities

    get_message(channel: Discord.TextChannel | Discord.ThreadChannel, id: string) {
        return new Promise<Discord.Message | undefined>((resolve, reject) => {
            channel.messages
                .fetch({ message: id, cache: true })
                .then(m => resolve(m))
                .catch(e => {
                    if (e.status == 404) {
                        resolve(undefined);
                    } else {
                        reject(e);
                    }
                });
        });
    }

    async message_has_resolution_from_root(message: Discord.Message) {
        const roots: reaction[] = [];
        for (const [_, reaction] of message.reactions.cache) {
            if (resolution_reactions_set.has(reaction.emoji.name!)) {
                const users = await reaction.users.fetch();
                for (const [_, user] of users) {
                    if (this.wheatley.is_root(user)) {
                        roots.push({ user, emoji: reaction.emoji });
                    }
                }
            }
        }
        if (roots.length > 0) {
            //M.debug("[sort]", roots.sort((a, b) => -a.user.id.localeCompare(b.user.id)).map(r => r.user.id));
            return roots.sort((a, b) => -a.user.id.localeCompare(b.user.id))[0];
        } else {
            return false;
        }
    }

    async get_display_name(thing: Discord.Message | Discord.User): Promise<string> {
        if (thing instanceof Discord.User) {
            const user = thing;
            try {
                return (await this.wheatley.TCCPP.members.fetch(user.id)).displayName;
            } catch {
                // user could potentially not be in the server
                return user.tag;
            }
        } else if (thing instanceof Discord.Message) {
            const message = thing;
            if (message.member == null) {
                return this.get_display_name(message.author);
            } else {
                return message.member.displayName;
            }
        } else {
            assert(false);
        }
    }

    async reverse_lookup(status_id: string) {
        const entry = await this.wheatley.database.server_suggestions.findOne({ status_message: status_id });
        return entry ? entry.suggestion : null;
    }

    isnt_actually_a_message(message: Discord.Message) {
        return message.type == Discord.MessageType.ThreadCreated && message.thread == null;
    }

    /*
     * New messages:
     * - Send message on the dashboard
     * - Create this.wheatley.database entry
     * On edit:
     * - If message is tracked, update it
     * On delete:
     * - If message is tracked, remove entry
     * On reaction
     * - If 🟢🔴🟡🚫 *and added by root* remove from dashboard
     * - Log resolution?
     * On reaction remove
     * - If 🟢🔴🟡🚫 *and there is no longer one present by a root member* re-add to dashboard
     * - Log reopen?
     * State recovery:
     * - Check if original messages were deleted
     * - Update with edits if necessary
     * - Scan messages since last seen
     * - Process unseen messages as if new if not already resolved
     * - Handle new 🟢🔴🟡🚫 reactions
     * - TODO: Handle removed 🟢🔴🟡🚫 reactions?
     * - Check for manual untracks
     * On 🟢🔴🟡🚫 reaction in the dashboard:
     * - Apply reaction to the main message and resolve suggestion
     *     Note: Not currently checked in recovery
     *     Note: Last 100 messages in the thread fetched and cached by server_suggestion_reactions
     * On status message delete in dashboard:
     * - Delete this.wheatley.database entry. This is a manual "No longer tracking the message".
     *
     * If a message is not tracked it is either resolved or missed.
     */

    // jump to message link
    // include media in embed?

    async make_embed(message: Discord.Message) {
        const reactions = message.reactions.cache;
        const up = (reactions.get("👍") || { count: 0 }).count;
        const down = (reactions.get("👎") || { count: 0 }).count;
        const maybe = (reactions.get("🤷") || { count: 0 }).count;
        return new Discord.EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${await this.get_display_name(message)}`,
                iconURL: message.author.displayAvatarURL(),
            })
            .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
            .setTimestamp(message.createdAt)
            .setFooter({
                text: `${up} 👍 ${down} 👎 ${maybe} 🤷`,
            });
    }

    // Two log operations:
    // - Log suggestion resolution
    // - Log suggestion reopen
    // Not logging deletions

    async log_resolution(message: Discord.Message, reaction: reaction) {
        const embed = new Discord.EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${await this.get_display_name(message)}`,
                iconURL: message.author.displayAvatarURL(),
            })
            .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
            .setFooter({
                text: `${await this.get_display_name(reaction.user)}: ${reaction.emoji}`,
                iconURL: reaction.user.displayAvatarURL(),
            })
            .setTimestamp(message.createdAt);
        await this.wheatley.channels.suggestion_action_log.send({ embeds: [embed] });
    }

    async log_reopen(message: Discord.Message) {
        const embed = new Discord.EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${await this.get_display_name(message)}`,
                iconURL: message.author.displayAvatarURL(),
            })
            .setDescription(message.content + `\n\n[[Jump to message]](${message.url})`)
            .setFooter({
                text: "Suggestion reopened",
            })
            .setTimestamp(message.createdAt);
        await this.wheatley.channels.suggestion_action_log.send({ embeds: [embed] });
    }

    // Four operations:
    // - open suggestion
    // - delete suggestion TODO: misnomer
    // - update suggestion if needed
    // - resolve suggestion
    // TODO: potentially may have reopen suggestion and untrack suggestion in the future
    // Note: Callers obtain mutex lock

    // Race condition handling: edits while processing edits, await status_message.delete() and on_message_delete()
    // interfering, etc.
    readonly mutex = new KeyedMutexSet<string>();
    readonly status_lock = new SelfClearingSet<string>(5 * MINUTE, 5 * MINUTE);

    async open_suggestion(message: Discord.Message, reopen = false) {
        try {
            M.log("New suggestion", message.author.tag, message.author.id, message.url);
            const embed = await this.make_embed(message);
            const status_message = await this.wheatley.channels.suggestion_dashboard.send({ embeds: [embed] });
            const bot_info = await this.wheatley.database.get_bot_singleton();
            const last_scanned = bot_info.server_suggestions.last_scanned_timestamp;
            if (message.createdTimestamp > last_scanned) {
                await this.wheatley.database.update_bot_singleton({
                    server_suggestions: {
                        last_scanned_timestamp: message.createdTimestamp,
                    },
                });
            }
            await this.wheatley.database.server_suggestions.insertOne({
                suggestion: message.id,
                status_message: status_message.id,
                hash: xxh3(message.content),
                up: 0,
                down: 0,
                maybe: 0,
            });
            // add react options
            if (!reopen) {
                for (const r of resolution_reactions) {
                    await status_message.react(r);
                }
            } else {
                if (message.thread) {
                    await message.thread.send({
                        embeds: [new Discord.EmbedBuilder().setColor(color).setDescription(`Suggestion reopened`)],
                    });
                }
            }
        } catch (e) {
            critical_error("error during open_suggestion", e);
        }
    }

    async delete_suggestion(message_id: string) {
        try {
            const entry = unwrap(await this.wheatley.database.server_suggestions.findOne({ suggestion: message_id }));
            M.log("Suggestion deleted", message_id, entry);
            const status_message = await this.wheatley.channels.suggestion_dashboard.messages.fetch(
                entry.status_message,
            );
            this.status_lock.insert(entry.status_message);
            await status_message.delete();
            await this.wheatley.database.server_suggestions.deleteOne({ suggestion: message_id });
        } catch (e) {
            critical_error("error during delete_suggestion", e);
        }
    }

    async update_message_if_needed(message: Discord.Message) {
        try {
            const entry = unwrap(await this.wheatley.database.server_suggestions.findOne({ suggestion: message.id }));
            const hash = xxh3(message.content);
            if (hash != entry.hash) {
                M.log("Suggestion edited", message.author.tag, message.author.id, message.url);
                const status_message = await this.wheatley.channels.suggestion_dashboard.messages.fetch(
                    entry.status_message,
                );
                const embed = await this.make_embed(message);
                await status_message.edit({ embeds: [embed] });
                entry.hash = hash;
                await this.wheatley.database.server_suggestions.updateOne({ suggestion: message.id }, { $set: entry });
                return true; // return if we updated
            } else {
                const reactions = message.reactions.cache;
                const up = (reactions.get("👍") || { count: 0 }).count;
                const down = (reactions.get("👎") || { count: 0 }).count;
                const maybe = (reactions.get("🤷") || { count: 0 }).count;
                if (entry.up != up || entry.down != down || entry.maybe != maybe) {
                    M.debug(
                        "Updating suggestion with new reactions",
                        message.author.tag,
                        message.author.id,
                        message.url,
                    );
                    const status_message = await this.wheatley.channels.suggestion_dashboard.messages.fetch(
                        entry.status_message,
                    );
                    const embed = await this.make_embed(message);
                    await status_message.edit({ embeds: [embed] });
                    entry.up = up;
                    entry.down = down;
                    entry.maybe = maybe;
                    await this.wheatley.database.server_suggestions.updateOne(
                        { suggestion: message.id },
                        { $set: entry },
                    );
                    return true; // return if we updated
                }
            }
            return false;
        } catch (e) {
            critical_error("error during update_message_if_needed", e);
        }
    }

    async resolve_suggestion(message: Discord.Message, reaction: reaction) {
        try {
            const entry = await this.wheatley.database.server_suggestions.findOne({ suggestion: message.id });
            if (entry) {
                M.log("Suggestion being resolved", [message.id]);
                // remove status message
                const status_message = await this.wheatley.channels.suggestion_dashboard.messages.fetch(
                    entry.status_message,
                );
                this.status_lock.insert(entry.status_message);
                await status_message.delete();
                await this.wheatley.database.server_suggestions.deleteOne({ suggestion: message.id });
                if (message.thread) {
                    await message.thread.send({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(color)
                                .setDescription(`Suggestion resolved as ${reaction.emoji}`),
                        ],
                    });
                }
                // if wheatley then this is logged when the reaction is done on the dashboard
                if (reaction.user.id != this.wheatley.id) {
                    await this.log_resolution(message, reaction);
                }
            } else {
                // already resolved
            }
        } catch (e) {
            critical_error("error during update_message_if_needed", e);
        }
    }

    async handle_suggestion_channel_message(message: Discord.Message) {
        await this.mutex.lock(message.id);
        await this.open_suggestion(message);
        this.mutex.unlock(message.id);
    }

    override async on_message_create(message: Discord.Message) {
        if (this.recovering) {
            return;
        }
        if (this.isnt_actually_a_message(message)) {
            return;
        }
        try {
            if (message.channel.id == this.wheatley.channels.server_suggestions.id) {
                await this.handle_suggestion_channel_message(message);
            } else if (message.content == "!suggestions-stats") {
                await message.reply({
                    content: `${await this.wheatley.database.server_suggestions.countDocuments()} open suggestions`,
                });
            }
        } catch (e) {
            critical_error(e);
        }
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (this.recovering) {
            return;
        }
        if (this.isnt_actually_a_message(message as Discord.Message)) {
            return;
        }
        try {
            if (message.channel.id == this.wheatley.channels.server_suggestions.id) {
                if (!(await this.wheatley.database.server_suggestions.findOne({ suggestion: message.id }))) {
                    // TODO: This can happen under normal operation, this is here as a debug check
                    M.log("Untracked suggestion deleted", message);
                    return;
                }
                await this.mutex.lock(message.id);
                await this.delete_suggestion(message.id);
                this.mutex.unlock(message.id);
            } else if (message.channel.id == this.wheatley.channels.suggestion_dashboard.id) {
                assert(message.author != null);
                // race condition with await status_message.delete() checked here
                if (message.author.id == this.wheatley.id && !this.status_lock.has(message.id)) {
                    // find and delete this.wheatley.database entry
                    const suggestion_id = await this.reverse_lookup(message.id);
                    if (suggestion_id == null) {
                        throw 0; // untracked  - this is an internal error or a race condition
                    } else {
                        M.info(
                            "server_suggestion tracker state recovery: Manual status delete",
                            suggestion_id,
                            await this.wheatley.database.server_suggestions.findOne({ suggestion: suggestion_id }),
                        );
                        await this.wheatley.database.server_suggestions.deleteOne({ suggestion: suggestion_id });
                    }
                }
            } else if (
                message.channel.id == this.wheatley.channels.suggestion_action_log.id &&
                message.author!.id == this.wheatley.id
            ) {
                M.log("Wheatley message deleted", message);
            }
        } catch (e) {
            critical_error(e);
        }
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        if (this.recovering) {
            return;
        }
        if (new_message.channel.id != this.wheatley.channels.server_suggestions.id) {
            return;
        }
        try {
            await this.mutex.lock(new_message.id);
            await this.update_message_if_needed(await departialize(new_message));
            this.mutex.unlock(new_message.id);
        } catch (e) {
            critical_error(e);
        }
    }

    async process_vote(
        _reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        _: Discord.User | Discord.PartialUser,
    ) {
        const reaction = await departialize(_reaction);
        if (reaction.emoji.name! == "👍" || reaction.emoji.name! == "👎" || reaction.emoji.name! == "🤷") {
            const message = await departialize(reaction.message);
            const entry = await this.wheatley.database.server_suggestions.findOne({ suggestion: message.id });
            if (entry) {
                M.debug("Suggestion vote", reaction.emoji.name, [message.id]);
                // update message
                const status_message = await this.wheatley.channels.suggestion_dashboard.messages.fetch(
                    entry.status_message,
                );
                const embed = await this.make_embed(message);
                await status_message.edit({ embeds: [embed] });
                if (reaction.emoji.name == "👍") {
                    entry.up = reaction.count;
                } else if (reaction.emoji.name == "👎") {
                    entry.down = reaction.count;
                } else {
                    // 🤷
                    entry.maybe = reaction.count;
                }
                await this.wheatley.database.server_suggestions.updateOne({ suggestion: message.id }, { $set: entry });
            } else {
                // already resolved
            }
        }
    }

    // Process a reaction, known to be a resolution reaction
    // Is root checked here
    async process_reaction(
        _reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ) {
        const reaction = await departialize(_reaction);
        if (resolution_reactions_set.has(reaction.emoji.name!)) {
            if (this.wheatley.is_root(user)) {
                await this.resolve_suggestion(await departialize(reaction.message), {
                    user: await departialize(user),
                    emoji: reaction.emoji,
                });
            }
        }
    }

    async process_reaction_remove(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ) {
        if (resolution_reactions_set.has(reaction.emoji.name!) && this.wheatley.is_root(user)) {
            const message = await departialize(reaction.message);
            if (!(await this.message_has_resolution_from_root(message))) {
                // reopen
                await this.open_suggestion(message, true);
                await this.log_reopen(message);
            }
        }
    }

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ) {
        if (this.recovering) {
            return;
        }
        try {
            if (reaction.message.channel.id == this.wheatley.channels.server_suggestions.id) {
                if (resolution_reactions_set.has(reaction.emoji.name!)) {
                    await this.mutex.lock(reaction.message.id);
                    await this.process_reaction(reaction, user);
                    this.mutex.unlock(reaction.message.id);
                } else if (vote_reaction_set.has(reaction.emoji.name!)) {
                    await this.mutex.lock(reaction.message.id);
                    await this.process_vote(reaction, user);
                    this.mutex.unlock(reaction.message.id);
                }
            } else if (reaction.message.channel.id == this.wheatley.channels.suggestion_dashboard.id) {
                const message = await departialize(reaction.message);
                if (
                    message.author.id == this.wheatley.id &&
                    user.id != this.wheatley.id && // ignore self - this is important for autoreacts
                    resolution_reactions_set.has(reaction.emoji.name!) &&
                    this.wheatley.is_root(user)
                ) {
                    // expensive-ish but this will be rare
                    const suggestion_id = await this.reverse_lookup(message.id);
                    if (suggestion_id == null) {
                        throw 0; // untracked  - this is an internal error or a race condition
                    } else {
                        // lock the status message
                        // NOTE: Assuming no identical snowflakes between channels, this should be pretty safe though
                        await this.mutex.lock(message.id);
                        const suggestion =
                            await this.wheatley.channels.server_suggestions.messages.fetch(suggestion_id);
                        await suggestion.react(reaction.emoji.name!);
                        await this.log_resolution(suggestion, {
                            user: await departialize(user),
                            emoji: reaction.emoji,
                        });
                        this.mutex.unlock(message.id);
                        // No further action done here: process_reaction will run when on_react will fires again as a
                        // result of suggestion.react
                    }
                }
            }
        } catch (e) {
            critical_error(e);
            try {
                if (this.wheatley.is_root(user)) {
                    // only send diagnostics to root
                    const member = await this.wheatley.TCCPP.members.fetch(user.id);
                    await member.send("Error while resolving suggestion");
                }
            } catch (e) {
                critical_error(e);
            }
        }
    }

    override async on_reaction_remove(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ) {
        if (this.recovering) {
            return;
        }
        if (reaction.message.channel.id != this.wheatley.channels.server_suggestions.id) {
            return;
        }
        try {
            if (resolution_reactions_set.has(reaction.emoji.name!)) {
                await this.mutex.lock(reaction.message.id);
                await this.process_reaction_remove(reaction, user);
                this.mutex.unlock(reaction.message.id);
            } else if (vote_reaction_set.has(reaction.emoji.name!)) {
                await this.mutex.lock(reaction.message.id);
                await this.process_vote(reaction, user);
                this.mutex.unlock(reaction.message.id);
            }
        } catch (e) {
            critical_error(e);
        }
    }

    async process_since_last_scanned() {
        // Note: No locking done here
        let last_scanned = (await this.wheatley.database.get_bot_singleton()).server_suggestions.last_scanned_timestamp;
        while (true) {
            // TODO: Sort collection???
            const messages = await this.wheatley.channels.server_suggestions.messages.fetch({
                limit: 100,
                after: forge_snowflake(last_scanned + 1),
                cache: true,
            });
            M.debug("process_since_last_scanned", messages.size);
            if (messages.size == 0) {
                break;
            }
            const arr: Discord.Message[] = [];
            for (const [_, message] of messages) {
                arr.push(message);
            }
            arr.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const message of arr) {
                if (this.isnt_actually_a_message(message)) {
                    continue;
                }
                const root_resolve = await this.message_has_resolution_from_root(message);
                if (root_resolve) {
                    // already resolved, just log
                    await this.log_resolution(message, root_resolve);
                    // update last seen
                    if (message.createdTimestamp > last_scanned) {
                        last_scanned = message.createdTimestamp;
                    }
                } else {
                    M.debug(
                        "server_suggestion tracker process_since_last_scanned: New message found:",
                        message.id,
                        message.author.tag,
                        message.content,
                    );
                    //if(message.createdTimestamp >
                    //      this.wheatley.database.state.suggestion_tracker.last_scanned_timestamp) {
                    //    assert(message.createdTimestamp == decode_snowflake(message.id));
                    //    this.wheatley.database.get<db_schema>("suggestion_tracker").last_scanned_timestamp =
                    //          message.createdTimestamp;
                    //}
                    await this.open_suggestion(message); // will .update() this.wheatley.database
                }
            }
            break;
        }
        await this.wheatley.database.update_bot_singleton({
            server_suggestions: {
                last_scanned_timestamp: last_scanned,
            },
        });
    }

    override async on_ready() {
        M.debug("server_suggestion tracker handler on_ready");
        // handle all new suggestions since last seen
        M.debug("server_suggestion tracker scanning since last seen");
        await this.process_since_last_scanned();
        M.debug("server_suggestion tracker finished scanning");
        this.recovering = false;
        // check this.wheatley.database entries and fetch since last_scanned_timestamp
        M.debug("server_suggestion tracker checking this.wheatley.database entries");
        try {
            for await (const entry of this.wheatley.database.server_suggestions.find()) {
                await this.mutex.lock(entry.suggestion);
                const message = await this.get_message(this.wheatley.channels.server_suggestions, entry.suggestion);
                let suggestion_was_resolved = false;
                if (message == undefined) {
                    // check if deleted
                    // deleted
                    M.debug("server_suggestion tracker state recovery: Message was deleted:", entry);
                    this.status_lock.insert(entry.status_message);
                    await this.delete_suggestion(entry.suggestion);
                } else {
                    // check if message updated
                    if (await this.update_message_if_needed(message)) {
                        M.debug("server_suggestion tracker state recovery: Message was updated:", entry);
                    }
                    // check reactions
                    //M.debug(message.content, message.reactions.cache.map(r => [r.emoji.name, r.count]));
                    const root_resolve = await this.message_has_resolution_from_root(message);
                    if (root_resolve) {
                        M.warn("server_suggestion tracker state recovery: resolving message");
                        suggestion_was_resolved = true;
                        await this.resolve_suggestion(message, root_resolve);
                    } else {
                        // no action needed
                    }
                }
                // check if the status message was deleted (if we didn't just delete it with resolve_suggestion)
                if (
                    !suggestion_was_resolved &&
                    (await this.get_message(this.wheatley.channels.suggestion_dashboard, entry.status_message)) ==
                        undefined
                ) {
                    // just delete from this.wheatley.database - no longer tracking
                    M.info("server_suggestion tracker state recovery: Manual status delete", entry.suggestion, entry);
                    await this.wheatley.database.server_suggestions.deleteOne({ suggestion: entry.suggestion });
                }
                // not currently checking root reactions on it - TODO?
                this.mutex.unlock(entry.suggestion);
            }
        } catch (e) {
            critical_error(e);
        }
        M.debug("server_suggestion tracker finished checking this.wheatley.database entries");
    }
}
