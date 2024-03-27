import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors, MINUTE, HOUR } from "../common.js";
import { M } from "../utils/debugging-and-logging.js";
import { SelfClearingMap } from "../utils/containers.js";

const failed_everyone_re = /(?:@everyone|@here)/g; // todo: word boundaries?

export interface AntiEveryoneMessageCache {
    reply_to: Discord.Message["id"];
    reply: Discord.Message;
}

/**
 * Responds to users attempting to ping @everyone or @here
 * with a message discouraging the behavior.
 */
export default class AntiEveryone extends BotComponent {
    /**
     * Replies that have been made to users who attempted to ping everyone.
     *
     * @note This is limited to the last hour, in order to keep memory usage down.
     */
    public replies: SelfClearingMap<Discord.User, AntiEveryoneMessageCache[]> = new SelfClearingMap(HOUR, MINUTE);
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message<boolean>): Promise<void> {
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
            const memberCount = this.wheatley.TCCPP.members.cache.size.toLocaleString("en-US");

            // Store the reply for later deletion, if necessary
            if (!this.replies.has(message.author)) {
                this.replies.set(message.author, []);
            }
            const reply = await message.reply({
                content: `Did you really just try to ping ${memberCount} people?`,
            });

            // Store the reply for later deletion, along with the message it was replying to
            this.replies.get(message.author)!.push({ reply_to: message.id, reply });
        }
    }

    /**
     * Deletes all Replies that were made to a particular user
     * @note this should be used to auto-hide spam message replies in order to try and reduce the effect of spam
     * @TODO: Actually bind this into the anti-spam system
     */
    async delete_replies(user: Discord.User) {
        if (!this.replies.has(user)) {
            return;
        }

        const deletedAll = Promise.all(
            this.replies.get(user)!.map(async reply_cache => {
                try {
                    await reply_cache.reply.delete();
                } catch (e) {
                    // If the message was already deleted, we don't need to do anything
                }
            }),
        );
        this.replies.remove(user);
        return deletedAll;
    }

    /**
     * Auto-delete replies to messages that were deleted
     * @param message The message that was deleted
     */
    override async on_message_delete(message: Discord.Message<boolean>): Promise<void> {
        if (Math.abs(Date.now() - message.createdTimestamp) > 1000) {
            // Message was likely deleted by the user, rather than automatically
            return;
        }

        const author = message.author;
        const replies = this.replies.get(author);
        const reply_cache = replies?.find(reply => reply.reply_to == message.id);
        if (reply_cache) {
            try {
                await reply_cache.reply.delete();
            } catch (e) {
                // If the message was already deleted, we don't need to do anything
            }
            this.replies.set(author, replies?.filter(reply => reply.reply_to !== message.id) ?? []);
        }
    }
}
