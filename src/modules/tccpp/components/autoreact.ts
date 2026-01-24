import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { delay } from "../../../utils/misc.js";
import { is_media_link_embed } from "../../../utils/discord.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { MINUTE, SECOND } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { SelfClearingMap } from "../../../utils/containers.js";
import { clear_timeout, set_timeout } from "../../../utils/node.js";

/* Here's a little of an explanation as to why we do this messageSnapshot stuff
 * A forwarded message is empty, however it contains a property messageSnapshot
 * This contains a `Collection` of snapshots, however currently it only has one
 * From there, we use the same method as before to check for media, embeds, etc
 */
export function has_media(message: Discord.Message | Discord.PartialMessage) {
    return message.reference?.type == Discord.MessageReferenceType.Forward
        ? forward_has_media(message)
        : regular_has_media(message);
}

function forward_has_media(message: Discord.Message | Discord.PartialMessage): boolean {
    const snapshot = message.messageSnapshots.first();
    return (
        snapshot?.attachments.some(a => a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/")) ||
        snapshot?.embeds.some(is_media_link_embed) ||
        false
    );
}

function regular_has_media(message: Discord.Message | Discord.PartialMessage): boolean {
    return (
        message.attachments.some(
            a => a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/") || false,
        ) || message.embeds.some(is_media_link_embed)
    );
}

const REACT_TIMEOUT = 90 * SECOND;

export default class Autoreact extends BotComponent {
    react_timeouts = new SelfClearingMap<string, NodeJS.Timeout>(REACT_TIMEOUT);

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
            message.author.id == this.wheatley.user.id || // Ignore self
            message.author.bot || // Ignore bots
            message.guildId != this.wheatley.guild.id // Ignore messages outside TCCPP (e.g. dm's)
        ) {
            return;
        }
        if (this.react_timeouts.has(message.author.id)) {
            clear_timeout(this.react_timeouts.get(message.author.id));
            this.react_timeouts.remove(message.author.id);
        }
        try {
            if (message.content.trim().match(/^wh?at(?:[!?]*\?[!?]*)?$/gi)) {
                this.react_timeouts.set(
                    message.author.id,
                    set_timeout(() => {
                        // Put an unmanaged non null assertion here because of the precondition requiring that guildId
                        // must be TCCPP (and thus always a valid guild)
                        const reaction = message.guild!.emojis.cache.find(emoji => emoji.name === "what");
                        if (reaction !== undefined) {
                            message.react(reaction).catch(this.wheatley.critical_error.bind(this.wheatley));
                        } else {
                            this.wheatley.warn("Unable to find emoji what");
                        }
                    }, REACT_TIMEOUT),
                );
            }
            if (message.content.trim().match(/^ok\.?$/gi)) {
                this.react_timeouts.set(
                    message.author.id,
                    set_timeout(() => {
                        message.react("🆗").catch(this.wheatley.critical_error.bind(this.wheatley));
                    }, REACT_TIMEOUT),
                );
            }
            if (message.content.trim().match(/^disagree[.!]?$/gi)) {
                await message.react("🛑");
            }
            if (
                message.content.trim().match(/\bwhy\b/gi) &&
                message.content.trim().match(/\bmonke\b/gi) &&
                message.content.trim().match(/\bam\b/gi) &&
                message.content.trim().match(/\bnamed\b/gi)
            ) {
                const reaction = message.guild!.emojis.cache.find(emoji => emoji.name === "monke2");
                if (reaction !== undefined) {
                    message.react(reaction).catch(this.wheatley.critical_error.bind(this.wheatley));
                } else {
                    this.wheatley.warn("Unable to find emoji monke2");
                }
            }
            if (message.content.includes("geeksforgeeks.org")) {
                const reaction = message.guild!.emojis.cache.find(emoji => emoji.name === "nog4g");
                if (reaction !== undefined) {
                    await message.react(reaction);
                } else {
                    this.wheatley.warn("Unable to find emoji nog4g");
                }
            }
            if (message.channel.id == this.wheatley.channels.introductions) {
                if (message.member == null) {
                    // TODO: Ping zelis?
                    M.warn("Why??", message);
                }
                if (await this.is_new_member(message)) {
                    await delay(1 * MINUTE);
                    M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                    await message.react("👋");
                }
            } else if (message.channel.id == this.wheatley.channels.memes && has_media(message)) {
                M.log("Adding star reaction", message.author.tag, message.author.id, message.url);
                await message.react("⭐");
            } else if (message.channel.id == this.wheatley.channels.server_suggestions) {
                M.log("Adding server suggestion reactions", message.author.tag, message.author.id, message.url);
                await message.react("👍");
                await message.react("👎");
                await message.react("🤷");
            } else if (message.channel.id == this.wheatley.channels.food && has_media(message)) {
                const reaction = message.guild!.emojis.cache.find(emoji => emoji.name === "chefskiss");
                if (reaction !== undefined) {
                    await message.react(reaction);
                } else {
                    this.wheatley.warn("Unable to find emoji chefskiss");
                }
            }
        } catch (e: any) {
            // reaction blocked
            if (e instanceof Discord.DiscordAPIError && e.code === 90001) {
                await message.member?.timeout(1 * MINUTE, "Thou shall not block the bot");
                if (message.channel.id == this.wheatley.channels.server_suggestions) {
                    await message.delete();
                }
            } else {
                throw e;
            }
        }
    }

    // Primarily here to catch url embeds, sometimes they aren't present in the initial message create
    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ): Promise<void> {
        if (
            new_message.author?.id == this.wheatley.user.id || // Ignore self
            new_message.author?.bot || // Ignore bots
            new_message.guildId != this.wheatley.guild.id // Ignore messages outside TCCPP (e.g. dm's)
        ) {
            return;
        }
        // Only consider messages under 5 minutes old to prevent reactions on very old messages
        if (new_message.createdTimestamp && Date.now() - new_message.createdTimestamp > 5 * MINUTE) {
            return;
        }
        if (new_message.channel.id == this.wheatley.channels.memes) {
            const bot_starred = new_message.reactions.cache.get("⭐")?.users.cache.has(this.wheatley.user.id);
            // If we haven't stared (or don't know if we've starred) and the new message has media, star
            if (!bot_starred && has_media(new_message)) {
                M.log(
                    "Adding star reaction on message update",
                    new_message.reactions.cache.has(this.wheatley.user.id),
                    new_message.author?.tag,
                    new_message.author?.id,
                    new_message.url,
                );
                await new_message.react("⭐");
            } else if (bot_starred && !has_media(new_message)) {
                // if we starred and there's no longer media, remove
                M.log(
                    "Removing star reaction on message update",
                    new_message.reactions.cache.has(this.wheatley.user.id),
                    new_message.author?.tag,
                    new_message.author?.id,
                    new_message.url,
                );
                await new_message.reactions.cache.get("⭐")?.users.remove(this.wheatley.user.id);
            }
        }
    }

    async catch_up() {
        const TCCPP = await this.wheatley.client.guilds.fetch(this.wheatley.guild.id);
        const introductions_channel = await TCCPP.channels.fetch(this.wheatley.channels.introductions);
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
