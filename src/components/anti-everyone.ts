import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { M } from "../utils/debugging-and-logging.js";
import { SelfClearingMap } from "../utils/containers.js";

const failed_everyone_re = /(?:@everyone|@here)/g; // todo: word boundaries?

export interface AntiEveryoneMessageCache extends Discord.Message {
    replyTo: Discord.Message["id"];
}

/**
 * Responds to users attempting to ping @everyone or @here
 * with a message discouraging the behavior.
 */
export default class AntiEveryone extends BotComponent {
    /**
     * Replies that have been made to users who attempted to ping everyone.
     *
     * @note This is limited to 50 replies, in order to keep memory usage down.
     */
    public replies: SelfClearingMap<Discord.User, AntiEveryoneMessageCache[]> = new SelfClearingMap(
        1000 * 60 * 60,
        1000 * 60,
    );
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
            this.replies.get(message.author)!.push(
                Object.assign(
                    {
                        replyTo: message.id,
                    },
                    reply,
                ),
            );
        }
    }

    /**
     * Deletes all Replies that were made to a particular user
     * @note this should be used to auto-hide spam message replies in order to try and reduce the effect of spam
     * @TODO: Actually bind this into the anti-spam system
     */
    async deleteReplies(user: Discord.User) {
        if (!this.replies.has(user)) {
            return;
        }

        const deletedAll = Promise.all(this.replies.get(user)!.map(reply => reply.delete()));
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
        const reply = replies?.find(reply => reply.replyTo == message.id);
        if (reply) {
            await reply.delete();
            this.replies.set(author, replies?.filter(reply => reply.id !== message.id) ?? []);
        }
    }
}
