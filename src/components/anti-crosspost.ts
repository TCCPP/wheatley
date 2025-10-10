import * as Discord from "discord.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { SelfClearingMap } from "../utils/containers.js";
import { levenshtein } from "../algorithm/levenshtein.js";

type message_info = {
    content: string;
    channel_id: string;
    timestamp: number;
    message_id: string;
};

const CROSSPOST_WINDOW = 15 * MINUTE;
const MIN_MESSAGE_LENGTH = 50;
const SIMILARITY_THRESHOLD = 0.3;

function normalize_content(content: string): string {
    return content.toLowerCase().trim().replace(/\s+/g, " ");
}

function calculate_similarity(content1: string, content2: string): number {
    const normalized1 = normalize_content(content1);
    const normalized2 = normalize_content(content2);
    const distance = levenshtein(normalized1, normalized2);
    const max_length = Math.max(normalized1.length, normalized2.length);
    return distance / max_length;
}

export default class AntiCrosspost extends BotComponent {
    private recent_messages = new SelfClearingMap<Discord.Snowflake, message_info[]>(CROSSPOST_WINDOW, 5 * MINUTE);

    override async on_message_create(message: Discord.Message) {
        if (
            message.author.id == this.wheatley.user.id ||
            message.author.bot ||
            message.guildId != this.wheatley.guild.id
        ) {
            return;
        }
        if (await this.wheatley.check_permissions(message.author, Discord.PermissionFlagsBits.ModerateMembers)) {
            return;
        }
        if (message.content.length < MIN_MESSAGE_LENGTH) {
            return;
        }
        if (message.channelId === this.wheatley.channels.bot_spam) {
            return;
        }
        let user_messages = this.recent_messages.get(message.author.id) ?? [];
        const cutoff_time = message.createdTimestamp - CROSSPOST_WINDOW;
        user_messages = user_messages.filter(m => m.timestamp > cutoff_time);
        const current_message: message_info = {
            content: message.content,
            channel_id: message.channelId,
            timestamp: message.createdTimestamp,
            message_id: message.id,
        };
        const crosspost_channels = new Set<string>();
        for (const prev_message of user_messages) {
            if (prev_message.channel_id === message.channelId) {
                continue;
            }
            const similarity = calculate_similarity(message.content, prev_message.content);
            if (similarity < SIMILARITY_THRESHOLD) {
                crosspost_channels.add(prev_message.channel_id);
            }
        }
        if (crosspost_channels.size > 0) {
            crosspost_channels.add(current_message.channel_id);
            M.log("Crosspost detected:", message.author.tag, "across", crosspost_channels.size + 1, "channels");
            const channel_list = Array.from(crosspost_channels)
                .map(id => `<#${id}>`)
                .join(", ");
            const reply = await message.reply(
                `Please don't cross-post the same message across multiple channels (${channel_list}). ` +
                    `Pick the most appropriate channel for your question and ask there.`,
            );
            this.wheatley.register_non_command_bot_reply(message, reply);
        }
        user_messages.push(current_message);
        this.recent_messages.set(message.author.id, user_messages);
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (!message.author || message.author.bot) {
            return;
        }
        const user_messages = this.recent_messages.get(message.author.id);
        if (user_messages) {
            const filtered = user_messages.filter(m => m.message_id !== message.id);
            this.recent_messages.set(message.author.id, filtered);
        }
    }
}
