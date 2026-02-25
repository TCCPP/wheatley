import * as Discord from "discord.js";

import { MINUTE } from "../common.js";
import { SelfClearingMap } from "./containers.js";
import { unwrap } from "./misc.js";
import { Wheatley } from "../wheatley.js";

type tracked_reply = {
    trigger_message_id?: string;
    reply: Discord.Message;
};

type reply_tracker_options = {
    delete_on_trigger_delete: boolean;
    trigger_delete_threshold: number;
};

async function try_delete(message: Discord.Message) {
    try {
        await message.delete();
    } catch (e) {
        if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
            // Unknown message, already deleted
        } else {
            throw e;
        }
    }
}

export class ReplyTracker {
    private replies = new SelfClearingMap<Discord.User, tracked_reply[]>(10 * MINUTE);
    private readonly options: reply_tracker_options = {
        delete_on_trigger_delete: false,
        trigger_delete_threshold: 1000,
    };

    constructor(
        private wheatley: Wheatley,
        options?: Partial<reply_tracker_options>,
    ) {
        if (options?.delete_on_trigger_delete) {
            this.options.delete_on_trigger_delete = options.delete_on_trigger_delete;
        }
        if (options?.trigger_delete_threshold) {
            this.options.trigger_delete_threshold = options.trigger_delete_threshold;
        }
        wheatley.event_hub.on("delete_bot_replies", user => {
            this.delete_replies(user).catch(wheatley.critical_error.bind(wheatley));
        });
        wheatley.client.on("messageDelete", message => {
            this.on_message_delete(message).catch(wheatley.critical_error.bind(wheatley));
        });
    }

    track(user: Discord.User, reply: Discord.Message, trigger_message_id?: string) {
        if (!this.replies.has(user)) {
            this.replies.set(user, []);
        }
        unwrap(this.replies.get(user)).push({ trigger_message_id, reply });
    }

    private async delete_replies(user: Discord.User) {
        if (!this.replies.has(user)) {
            return;
        }
        for (const entry of unwrap(this.replies.get(user))) {
            await try_delete(entry.reply);
        }
        this.replies.remove(user);
    }

    private async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (!this.options.delete_on_trigger_delete) {
            return;
        }
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (Math.abs(Date.now() - message.createdTimestamp) > this.options.trigger_delete_threshold) {
            return;
        }
        const author = message.author;
        if (!author) {
            return;
        }
        const entries = this.replies.get(author);
        const entry = entries?.find(e => e.trigger_message_id === message.id);
        if (entry) {
            await try_delete(entry.reply);
            this.replies.set(author, entries?.filter(e => e.trigger_message_id !== message.id) ?? []);
        }
    }
}
