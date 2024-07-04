import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors, MINUTE, HOUR } from "../common.js";
import { M } from "../utils/debugging-and-logging.js";
import { SelfClearingMap } from "../utils/containers.js";
import { unwrap } from "../utils/misc.js";

const failed_everyone_re = /\b(?:@everyone|@here)\b/g;

export interface AntiEveryoneMessageCache {
    reply_to: string;
    reply: Discord.Message;
}

export default class AntiEveryone extends BotComponent {
    /**
     * Replies that have been made to users who attempted to ping everyone.
     */
    replies = new SelfClearingMap<Discord.User, AntiEveryoneMessageCache[]>(10 * MINUTE);
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message): Promise<void> {
        if (
            // self
            message.author.id == this.wheatley.client.user!.id ||
            // bot
            message.author.bot ||
            // mod
            this.wheatley.is_authorized_mod(message.author) ||
            // outside of TCCPP (like DMs)
            message.guildId != this.wheatley.TCCPP.id
        ) {
            return;
        }
        if (message.content.match(failed_everyone_re) != null) {
            // NOTE: .toLocaleString("en-US") formats this number with commas.
            const member_count = this.wheatley.TCCPP.members.cache.size.toLocaleString("en-US");

            // Store the reply for later deletion, if necessary
            if (!this.replies.has(message.author)) {
                this.replies.set(message.author, []);
            }
            const reply = await message.reply({
                content: `Did you really just try to ping ${member_count} people?`,
            });

            // Store the reply for later deletion, along with the message it was replying to
            unwrap(this.replies.get(message.author)).push({ reply_to: message.id, reply });
        }
    }

    /**
     * Deletes all `Did you really try to ping ... people?` replies that were made to a particular user
     */
    async delete_replies(user: Discord.User) {
        if (!this.replies.has(user)) {
            return;
        }

        // For loop to wait for each reply to be deleted, before moving on to the next one
        for (const reply_cache of unwrap(this.replies.get(user))) {
            try {
                await reply_cache.reply.delete();
            } catch (e) {
                // If the message was already deleted, we don't need to do anything
            }
        }
        // Remove the user from the cache, mainly to reduce clutter
        this.replies.remove(user);
    }

    /**
     * Auto-delete replies to messages that were deleted
     */
    override async on_message_delete(message: Discord.Message): Promise<void> {
        if (Math.abs(Date.now() - message.createdTimestamp) > 1000) {
            // Message was likely deleted by the user, rather than automatically
            return;
        }

        const author = message.author;
        const replies = this.replies.get(author);

        // Get the reply that was made to this message, if it exists
        const reply_cache = replies?.find(reply => reply.reply_to == message.id);
        if (reply_cache) {
            try {
                await reply_cache.reply.delete();
            } catch (e) {
                // If the message was already deleted, we don't need to do anything
            }

            // Remove the reply from the cache
            this.replies.set(author, replies?.filter(reply => reply.reply_to !== message.id) ?? []);
        }
    }
}
