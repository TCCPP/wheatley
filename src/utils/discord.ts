import { strict as assert } from "assert";
import * as Discord from "discord.js";
import { unwrap } from "./misc.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { is_string } from "./strings.js";
import { markdown_node, MarkdownParser } from "dismark";

// https://stackoverflow.com/questions/64053658/get-emojis-from-message-discord-js-v12
// https://www.reddit.com/r/Discord_Bots/comments/gteo6t/discordjs_is_there_a_way_to_detect_emojis_in_a/
export const EMOJIREGEX = /((?<!\\)<a?:[^:]+:(\d+)>)|\p{Emoji_Presentation}\S*|\p{Extended_Pictographic}\S*/gmu;
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

export type MessageLocation = {
    guild: string;
    channel: string;
    id: string;
};

export function make_url(
    thing: Discord.GuildChannel | Discord.TextChannel | Discord.ThreadChannel | Discord.ChatInputCommandInteraction,
    message_snowflake?: string,
): string;
export function make_url(thing: MessageLocation | Discord.Message): string;
export function make_url(
    thing:
        | Discord.GuildChannel
        | Discord.TextChannel
        | Discord.ThreadChannel
        | Discord.ChatInputCommandInteraction
        | MessageLocation
        | Discord.Message,
    message_snowflake?: string,
) {
    if (
        thing instanceof Discord.GuildChannel ||
        thing instanceof Discord.TextChannel ||
        thing instanceof Discord.ThreadChannel
    ) {
        if (message_snowflake) {
            return `https://discord.com/channels/${thing.guildId}/${thing.id}`;
        } else {
            return `https://discord.com/channels/${thing.guildId}/${thing.id}/${message_snowflake}`;
        }
    }
    if (thing instanceof Discord.ChatInputCommandInteraction) {
        if (message_snowflake) {
            return `https://discord.com/channels/${thing.guildId}/${thing.channelId}`;
        } else {
            return `https://discord.com/channels/${thing.guildId}/${thing.channelId}/${message_snowflake}`;
        }
    }
    assert(!message_snowflake);
    if (thing instanceof Discord.Message) {
        return `https://discord.com/channels/${thing.guildId}/${thing.channelId}/${thing.id}`;
    }
    return `https://discord.com/channels/${thing.guild}/${thing.channel}/${thing.id}`;
}

export function textchannelify(x: Discord.Channel): Discord.TextBasedChannel {
    assert(x.isTextBased());
    return x;
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

export function is_media_link_embed(embed: Discord.APIEmbed | Discord.Embed) {
    // It is possible for a thumbnail but no image/video to be present
    return embed.image || embed.video || embed.thumbnail;
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

const DISCORD_EPOCH = 1420070400000;

// Decode a snowflake as milliseconds since unix epoch
export function decode_snowflake(snowflake_text: string) {
    const snowflake = BigInt.asUintN(64, BigInt(snowflake_text));
    return DISCORD_EPOCH + Number(snowflake >> 22n); // milliseconds
}

// Milliseconds since unix epoch to snowflake
export function forge_snowflake(timestamp: number) {
    assert(timestamp > DISCORD_EPOCH);
    const snowflake = BigInt(timestamp - DISCORD_EPOCH) << 22n;
    return snowflake.toString();
}

// https://gist.github.com/LeviSnoot/d9147767abeef2f770e9ddcd91eb85aa
// Takes ms since epoch
export function discord_timestamp(timestamp: number, suffix = "f") {
    return `<t:${Math.round(timestamp / 1000)}:${suffix}>`;
}

export const raw_discord_url_re = /https:\/\/(.*discord.*)\/channels\/(\d+)\/(\d+)\/(\d+)/;
export const known_discord_domains = new Set([
    "discord.com",
    "ptb.discord.com",
    "canary.discord.com",
    "discordapp.com",
]);
export const discord_url_re = new RegExp(`^${raw_discord_url_re.source}$`, "i");
export function parse_url_or_snowflake(url: string): [string | null, string | null, string] {
    let match = url.trim().match(discord_url_re);
    if (match) {
        const [_, guild_id, channel_id, message_id] = match.slice(1);
        return [guild_id, channel_id, message_id];
    }
    match = url.trim().match(/^\d+$/);
    if (match) {
        return [null, null, match[0]];
    }
    assert(false);
}

export function split_message_markdown_aware(content: string, limit = 2000): string[] {
    if (content.length <= limit) {
        return [content];
    }

    const parser = new MarkdownParser();
    const ast = parser.parse(content);
    const chunks: string[] = [];
    let current_chunk = "";
    let open_code_block: { language: string } | null = null;

    const add_to_chunk = (text: string) => {
        if (current_chunk.length + text.length <= limit) {
            current_chunk += text;
        } else {
            const remaining_space = limit - current_chunk.length;
            if (remaining_space > 0) {
                current_chunk += text.substring(0, remaining_space);
                chunks.push(current_chunk);
                current_chunk = "";
                add_to_chunk(text.substring(remaining_space));
            } else {
                chunks.push(current_chunk);
                current_chunk = "";
                add_to_chunk(text);
            }
        }
    };

    const close_code_block_if_needed = () => {
        if (open_code_block !== null) {
            add_to_chunk("\n```");
            chunks.push(current_chunk);
            current_chunk = `\`\`\`${open_code_block.language}\n`;
        }
    };

    const process_node = (node: markdown_node): void => {
        switch (node.type) {
            case "doc":
                node.content.forEach(process_node);
                break;
            case "code_block": {
                close_code_block_if_needed();
                const language = node.language ?? "";
                const lines = node.content.split("\n");
                open_code_block = { language };
                add_to_chunk(`\`\`\`${language}\n`);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const line_with_newline = i < lines.length - 1 ? line + "\n" : line;

                    if (current_chunk.length + line_with_newline.length + 4 > limit) {
                        add_to_chunk("\n```");
                        chunks.push(current_chunk);
                        current_chunk = `\`\`\`${language}\n${line_with_newline}`;
                    } else {
                        add_to_chunk(line_with_newline);
                    }
                }

                add_to_chunk("\n```");
                open_code_block = null;
                break;
            }
            case "inline_code":
                close_code_block_if_needed();
                add_to_chunk(`\`${node.content}\``);
                break;
            case "plain":
                close_code_block_if_needed();
                add_to_chunk(node.content);
                break;
            case "italics":
                close_code_block_if_needed();
                add_to_chunk("*");
                process_node(node.content);
                add_to_chunk("*");
                break;
            case "bold":
                close_code_block_if_needed();
                add_to_chunk("**");
                process_node(node.content);
                add_to_chunk("**");
                break;
            case "underline":
                close_code_block_if_needed();
                add_to_chunk("__");
                process_node(node.content);
                add_to_chunk("__");
                break;
            case "strikethrough":
                close_code_block_if_needed();
                add_to_chunk("~~");
                process_node(node.content);
                add_to_chunk("~~");
                break;
            case "spoiler":
                close_code_block_if_needed();
                add_to_chunk("||");
                process_node(node.content);
                add_to_chunk("||");
                break;
            case "masked_link":
                close_code_block_if_needed();
                add_to_chunk("[");
                process_node(node.content);
                add_to_chunk(`](${node.target})`);
                break;
            case "header":
                close_code_block_if_needed();
                add_to_chunk("#".repeat(node.level) + " ");
                process_node(node.content);
                add_to_chunk("\n");
                break;
            case "blockquote":
                close_code_block_if_needed();
                add_to_chunk("> ");
                process_node(node.content);
                add_to_chunk("\n");
                break;
            case "subtext":
                close_code_block_if_needed();
                add_to_chunk("-# ");
                process_node(node.content);
                add_to_chunk("\n");
                break;
            case "list":
                close_code_block_if_needed();
                for (let i = 0; i < node.items.length; i++) {
                    if (node.start_number) {
                        add_to_chunk(`${node.start_number + i}. `);
                    } else {
                        add_to_chunk("- ");
                    }
                    process_node(node.items[i]);
                    add_to_chunk("\n");
                }
                break;
            default:
                throw new Error(`Unhandled markdown node type: ${(node as markdown_node).type}`);
        }
    };

    process_node(ast);

    if (current_chunk.length > 0) {
        chunks.push(current_chunk);
    }

    return chunks;
}

export async function send_long_message_markdown_aware(
    channel: Discord.TextBasedChannel,
    msg: string,
    extra_options: Discord.MessageCreateOptions = {},
): Promise<Discord.Message | undefined> {
    assert(!(channel instanceof Discord.PartialGroupDMChannel));

    const chunks = split_message_markdown_aware(msg);
    let first_message: Discord.Message | undefined;

    for (let i = 0; i < chunks.length; i++) {
        const is_last = i === chunks.length - 1;

        const sent_message = await channel.send({
            content: chunks[i],
            ...(is_last ? extra_options : { allowedMentions: extra_options.allowedMentions }),
        });

        if (i === 0) {
            first_message = sent_message;
        }
    }

    return first_message;
}

export async function send_long_response_markdown_aware(
    command_object: Discord.MessageContextMenuCommandInteraction | TextBasedCommand,
    msg: string,
    ephemeral_if_possible = false,
    extra_options?: Omit<Discord.InteractionReplyOptions, "content" | "ephemeral" | "components">,
): Promise<void> {
    const chunks = split_message_markdown_aware(msg);
    const { files, embeds, ...rest_options } = extra_options ?? {};
    for (let i = 0; i < chunks.length; i++) {
        const is_last = i === chunks.length - 1;
        await (
            command_object.replied &&
            (command_object instanceof Discord.MessageContextMenuCommandInteraction || !command_object.is_editing)
                ? command_object.followUp
                : command_object.reply
        ).bind(command_object)({
            ephemeral: ephemeral_if_possible,
            ephemeral_if_possible,
            content: chunks[i],
            ...rest_options,
            ...(is_last ? { files, embeds } : {}),
        });
    }
}
