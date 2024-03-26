import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { M } from "../utils/debugging-and-logging.js";

const failed_everyone_re = /(?:@everyone|@here)/g; // todo: word boundaries?

/**
 * @TODO: This will likely grow rather large, thus it may be a good idea to offload this into a full database/disk storage
 */
const replies = new Map();

/**
 * Responds to users attempting to ping @everyone or @here
 * with a message discouraging the behavior.
 */
export default class AntiEveryone extends BotComponent {
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
            await message.reply({
                content: `Did you really just try to ping ${memberCount} people?`,
            });
            if(!replies.has(message.author.id) replies[message.author.id] = [];
            replies[message.author.id].push(message);
        }
    }
}

/**
 * Deletes all Replies that were made to a particular user
 * @note this should be used to auto-hide spam message replies in order to try and reduce the effect of spam
 * @TODO: Actually bind this into the anti-spam system
 */
export function deleteReplies(user: Discord.User) {
    if(replies[user.id]) replies.forEach(reply => reply.deleteReply());
    replies.delete(user.id);
}
