import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { delay } from "../utils/misc.js";
import { is_media_link_embed } from "../utils/discord.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

export function has_media(message: Discord.Message | Discord.PartialMessage) {
    return (
        message.attachments.some(
            a => a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/") || false,
        ) || message.embeds.some(is_media_link_embed)
    );
}

/**
 * Adds automatic reactions to some messages.
 */
export default class Autoreact extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        await this.catch_up();
    }

    async is_new_member(message: Discord.Message) {
        let member: Discord.GuildMember;
        if (message.member == null) {
            try {
                member = await message.guild!.members.fetch(message.author.id);
            } catch (error) {
                M.warn("Failed to get user", message.author.id);
                return false;
            }
        } else {
            member = message.member;
        }
        assert(member.joinedTimestamp != null);
        return Date.now() - member.joinedTimestamp <= 4 * 24 * 60 * MINUTE;
    }

    override async on_message_create(message: Discord.Message) {
        if (
            message.author.id == this.wheatley.client.user!.id || // Ignore self
            message.author.bot || // Ignore bots
            message.guildId != this.wheatley.TCCPP.id // Ignore messages outside TCCPP (e.g. dm's)
        ) {
            return;
        }
        try {
            if (message.content.trim().match(/^wh?at(?:[!?]*\?[!?]*)?$/gi)) {
                // Put an unmanaged non null assertion here because of the precondition requiring that guildId must be
                // TCCPP (and thus always a valid guild)
                const reaction = message.guild!.emojis.cache.find(emoji => emoji.name === "thcampbell");
                if (reaction !== undefined) {
                    await message.react(reaction);
                }
            }
            if (message.channel.id == this.wheatley.channels.introductions.id) {
                if (message.member == null) {
                    // TODO: Ping zelis?
                    M.warn("Why??", message);
                }
                if (await this.is_new_member(message)) {
                    await delay(1 * MINUTE);
                    M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                    await message.react("👋");
                }
            } else if (message.channel.id == this.wheatley.channels.memes.id && has_media(message)) {
                M.log("Adding star reaction", message.author.tag, message.author.id, message.url);
                await message.react("⭐");
            } else if (message.channel.id == this.wheatley.channels.server_suggestions.id) {
                M.log("Adding server suggestion reactions", message.author.tag, message.author.id, message.url);
                await message.react("👍");
                await message.react("👎");
                await message.react("🤷");
            }
        } catch (e: any) {
            // reaction blocked
            if (e.code === 90001) {
                await message.member?.timeout(1 * MINUTE, "Thou shall not block the bot");
                if (message.channel.id == this.wheatley.channels.server_suggestions.id) {
                    await message.delete();
                }
            } else {
                throw e;
            }
        }
    }

    // Primarily here to catch url embeds, sometimes they aren't present in the initial message create
    override async on_message_update(
        old_message: Discord.Message<boolean> | Discord.PartialMessage,
        new_message: Discord.Message<boolean> | Discord.PartialMessage,
    ): Promise<void> {
        if (
            new_message.author?.id == this.wheatley.client.user!.id || // Ignore self
            new_message.author?.bot || // Ignore bots
            new_message.guildId != this.wheatley.TCCPP.id // Ignore messages outside TCCPP (e.g. dm's)
        ) {
            return;
        }
        if (new_message.channel.id == this.wheatley.channels.memes.id) {
            const bot_starred = new_message.reactions.cache.get("⭐")?.users.cache.has(this.wheatley.id);
            // If we haven't stared (or don't know if we've starred) and the new message has media, star
            if (!bot_starred && has_media(new_message)) {
                M.log(
                    "Adding star reaction on message update",
                    new_message.reactions.cache.has(this.wheatley.id),
                    new_message.author?.tag,
                    new_message.author?.id,
                    new_message.url,
                );
                await new_message.react("⭐");
            } else if (bot_starred && !has_media(new_message)) {
                // if we starred and there's no longer media, remove
                M.log(
                    "Removing star reaction on message update",
                    new_message.reactions.cache.has(this.wheatley.id),
                    new_message.author?.tag,
                    new_message.author?.id,
                    new_message.url,
                );
                await new_message.reactions.cache.get("⭐")?.users.remove(this.wheatley.id);
            }
        }
    }

    async catch_up() {
        const TCCPP = await this.wheatley.client.guilds.fetch(this.wheatley.TCCPP.id);
        const introductions_channel = await TCCPP.channels.fetch(this.wheatley.channels.introductions.id);
        assert(introductions_channel);
        assert(introductions_channel.type == Discord.ChannelType.GuildText);
        const messages = await introductions_channel.messages.fetch({ limit: 100, cache: false });
        for (const [_, message] of messages) {
            if (await this.is_new_member(message)) {
                M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                await message.react("👋");
            }
        }
        M.log("Finished catching up on introduction messages");
    }
}
