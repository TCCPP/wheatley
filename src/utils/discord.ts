import { strict as assert } from "assert";
import * as Discord from "discord.js";
import { client } from "./debugging-and-logging.js";
import { unwrap } from "./misc.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { is_string } from "./strings.js";

// https://stackoverflow.com/questions/64053658/get-emojis-from-message-discord-js-v12
// https://www.reddit.com/r/Discord_Bots/comments/gteo6t/discordjs_is_there_a_way_to_detect_emojis_in_a/
export const EMOJIREGEX = /((?<!\\)<a?:[^:]+:(\d+)>)|\p{Emoji_Presentation}\S+|\p{Extended_Pictographic}\S+/gmu;
export const CUSTOM_EMOJIREGEX = /((?<!\\)<(a?):([^:]+):(\d+)>)/gmu;

type PotentiallyPartial =
    | Discord.User
    | Discord.PartialUser
    | Discord.GuildMember
    | Discord.PartialGuildMember
    | Discord.Message
    | Discord.PartialMessage
    | Discord.MessageReaction
    | Discord.PartialMessageReaction;
export async function departialize<T extends PotentiallyPartial, R extends ReturnType<T["fetch"]>>(
    thing: T,
): Promise<R> {
    if (thing.partial) {
        return (await thing.fetch()) as R;
    } else {
        return thing as any as R;
    }
}

export function get_url_for(channel: Discord.GuildChannel | Discord.TextChannel | Discord.ThreadChannel) {
    return `https://discord.com/channels/${channel.guildId}/${channel.id}`;
}

export function textchannelify(x: Discord.Channel): Discord.TextBasedChannel {
    assert(x.isTextBased());
    return x;
}

export async function fetch_text_channel(id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const channel = await client.channels.fetch(id);
    assert(channel && channel instanceof Discord.TextChannel);
    return channel;
}

export async function fetch_forum_channel(id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const channel = await client.channels.fetch(id);
    assert(channel && channel instanceof Discord.ForumChannel);
    return channel;
}

export async function fetch_thread_channel(channel: Discord.TextChannel, id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const thread = await channel.threads.fetch(id);
    assert(thread && thread instanceof Discord.ThreadChannel);
    return thread;
}

export function get_tag(channel: Discord.ForumChannel, name: string) {
    const candidates = channel.availableTags.filter(tag => tag.name == name);
    assert(
        candidates.length == 1,
        `Did someone change the tag name?? ` +
            `Looking for ${name} in ${channel.availableTags.map(tag => tag.name).join(",")}`,
    );
    return candidates[0];
}

export async function fetch_active_threads(forum: Discord.ForumChannel) {
    const { threads } = await forum.threads.fetchActive();
    // Workaround discord api / discord.js bug where fetchActive returns all threads, not just in the forum requested
    return threads.filter(thread => thread.parentId === forum.id);
}

export async function fetch_inactive_threads_time_limit(forum: Discord.ForumChannel, soft_limit?: number) {
    let before: string | undefined = undefined;
    const now = Date.now();
    const thread_entries: [string, Discord.ThreadChannel][] = [];
    while (true) {
        const { threads, hasMore } = await forum.threads.fetchArchived({ before });
        thread_entries.push(...threads);
        // The type annotation is needed because of a typescript bug
        // https://github.com/microsoft/TypeScript/issues/51115
        const last: Discord.ThreadChannel = threads.last()!;
        before = last.id;
        if (!hasMore || (soft_limit && Math.abs(now - unwrap(last.createdAt).getTime()) >= soft_limit)) {
            break;
        }
    }
    return new Discord.Collection(thread_entries);
}

export async function fetch_all_threads_time_limit(forum: Discord.ForumChannel, soft_limit?: number) {
    const threads = new Discord.Collection([
        ...(await fetch_active_threads(forum)),
        ...(await fetch_inactive_threads_time_limit(forum, soft_limit)),
    ]);
    return threads;
}

export async function fetch_inactive_threads_count(forum: Discord.ForumChannel, count: number) {
    let before: string | undefined = undefined;
    const thread_entries: [string, Discord.ThreadChannel][] = [];
    while (true) {
        const { threads, hasMore } = await forum.threads.fetchArchived({ before, limit: Math.min(count, 100) });
        thread_entries.push(...threads);
        // The type annotation is needed because of a typescript bug
        // https://github.com/microsoft/TypeScript/issues/51115
        const last: Discord.ThreadChannel = threads.last()!;
        before = last.id;
        count -= threads.size;
        if (!hasMore || count <= 0) {
            break;
        }
    }
    return new Discord.Collection(thread_entries);
}

export async function fetch_all_threads_archive_count(forum: Discord.ForumChannel, count: number) {
    const threads = new Discord.Collection([
        ...(await fetch_active_threads(forum)),
        ...(await fetch_inactive_threads_count(forum, count)),
    ]);
    return threads;
}

export function is_media_link_embed(embed: Discord.Embed) {
    // It is possible for a thumbnail but no image/video to be present
    return embed.image || embed.video || embed.thumbnail;
}

export async function send_long_message(channel: Discord.TextChannel | Discord.DMChannel, msg: string) {
    if (msg.length > 2000) {
        const lines = msg.split("\n");
        let partial = "";
        const queue: string[] = [];
        while (lines.length > 0) {
            if (partial.length + lines[0].length + 1 <= 2000) {
                if (partial != "") {
                    partial += "\n";
                }
                partial += lines.shift();
            } else {
                queue.push(partial);
                partial = "";
            }
        }
        if (partial != "") {
            queue.push(partial);
        }
        while (queue.length > 0) {
            await channel.send(queue.shift()!);
        }
    } else {
        await channel.send(msg);
    }
}

export async function send_long_response(
    command_object: Discord.MessageContextMenuCommandInteraction | TextBasedCommand,
    msg: string,
    ephemeral_if_possible = false,
    flags?: Discord.MessageFlags.SuppressEmbeds,
) {
    const queue: string[] = [];
    if (msg.length > 2000) {
        const lines = msg.split("\n");
        let partial = "";
        while (lines.length > 0) {
            if (partial.length + lines[0].length + 1 <= 2000) {
                if (partial != "") {
                    partial += "\n";
                }
                partial += lines.shift();
            } else {
                queue.push(partial);
                partial = "";
            }
        }
        if (partial != "") {
            queue.push(partial);
        }
    } else {
        queue.push(msg);
    }
    while (queue.length > 0) {
        await (command_object.replied &&
        (command_object instanceof Discord.MessageContextMenuCommandInteraction || !command_object.is_editing)
            ? command_object.followUp
            : command_object.reply
        ).bind(command_object)({
            ephemeral: ephemeral_if_possible,
            ephemeral_if_possible,
            content: unwrap(queue.shift()),
            flags,
        });
    }
}

export async function api_wrap<R>(fn: () => Promise<R>, ignored_errors: Discord.RESTJSONErrorCodes[]) {
    try {
        return await fn();
    } catch (e) {
        if (e instanceof Discord.DiscordAPIError) {
            assert(!is_string(e.code));
            if (ignored_errors.includes(e.code)) {
                return null;
            }
        }
        throw e;
    }
}
