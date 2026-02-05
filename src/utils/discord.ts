import { strict as assert } from "assert";
import * as Discord from "discord.js";
import { delay, unwrap } from "./misc.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { is_string } from "./strings.js";
import { markdown_node, MarkdownParser } from "dismark";
import { M } from "./debugging-and-logging.js";

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
        const last = threads.last();
        before = last?.id;
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

    type add_context = {
        wrap_open?: string;
        wrap_close?: string;
        continuation_prefix?: string;
    };

    const INLINE_FORMATS: Record<string, string> = {
        italics: "*",
        bold: "**",
        underline: "__",
        strikethrough: "~~",
        spoiler: "||",
    };

    const BLOCK_PATTERNS = ["> ", "-# ", "# ", "## ", "### ", "#### ", "##### ", "###### "];

    const split_on_word_boundary = (text: string, max_length: number): string => {
        if (text.length <= max_length) {
            return text;
        }
        let split_pos = max_length;

        // First, try to split on a newline
        const last_newline = text.lastIndexOf("\n", split_pos);
        if (last_newline !== -1 && last_newline > 0) {
            split_pos = last_newline;
        } else {
            // Fall back to splitting on a space
            while (split_pos > 0 && text[split_pos] !== " ") {
                split_pos--;
            }
            if (split_pos === 0) {
                return text.substring(0, max_length);
            }

            const before_split = text.substring(0, split_pos);
            for (const pattern of BLOCK_PATTERNS) {
                const pattern_pos = before_split.lastIndexOf(" " + pattern);
                if (pattern_pos !== -1 && pattern_pos > split_pos - 20) {
                    split_pos = pattern_pos;
                    break;
                }
            }
        }

        return text.substring(0, split_pos);
    };

    const flush_chunk = () => {
        if (current_chunk.length > 0) {
            chunks.push(current_chunk);
            current_chunk = "";
        }
    };

    const get_block_pattern_prefix = (text: string): string => {
        for (const pattern of BLOCK_PATTERNS) {
            if (text.startsWith(pattern)) {
                return pattern;
            }
        }
        return "";
    };

    const add_with_context = (text: string, context: add_context = {}) => {
        const { wrap_open = "", wrap_close = "", continuation_prefix = "" } = context;
        const full_text = wrap_open + text + wrap_close;

        if (current_chunk.length + full_text.length <= limit) {
            current_chunk += full_text;
            return;
        }

        if (current_chunk.length > 0) {
            const overhead = wrap_open.length + wrap_close.length;
            const available = limit - current_chunk.length - overhead;

            if (available > 0) {
                const first_part = split_on_word_boundary(text, available);
                if (first_part.length > 0) {
                    current_chunk += wrap_open + first_part + wrap_close;
                    flush_chunk();
                    let remaining = text.substring(first_part.length).trimStart();
                    if (remaining.length > 0) {
                        const block_prefix = get_block_pattern_prefix(text);
                        if (block_prefix && !remaining.startsWith(block_prefix)) {
                            remaining = block_prefix + remaining;
                        }
                        add_with_context(continuation_prefix + remaining, context);
                    }
                    return;
                }
            }
            flush_chunk();
        }

        if (full_text.length <= limit) {
            current_chunk = full_text;
        } else {
            const overhead = wrap_open.length + wrap_close.length;
            const available = limit - overhead;
            const first_part = split_on_word_boundary(text, available);
            current_chunk = wrap_open + first_part + wrap_close;
            flush_chunk();
            let remaining = text.substring(first_part.length).trimStart();
            if (remaining.length > 0) {
                const block_prefix = get_block_pattern_prefix(text);
                if (block_prefix && !remaining.startsWith(block_prefix)) {
                    remaining = block_prefix + remaining;
                }
                add_with_context(continuation_prefix + remaining, context);
            }
        }
    };

    const render_node_to_string = (node: markdown_node, indent = ""): string => {
        switch (node.type) {
            case "plain":
                return node.content;
            case "inline_code":
                return `\`${node.content}\``;
            case "italics":
                return `*${render_node_to_string(node.content, indent)}*`;
            case "bold":
                return `**${render_node_to_string(node.content, indent)}**`;
            case "underline":
                return `__${render_node_to_string(node.content, indent)}__`;
            case "strikethrough":
                return `~~${render_node_to_string(node.content, indent)}~~`;
            case "spoiler":
                return `||${render_node_to_string(node.content, indent)}||`;
            case "masked_link":
                return `[${render_node_to_string(node.content, indent)}](${node.target})`;
            case "header":
                return `${"#".repeat(node.level)} ${render_node_to_string(node.content, indent)}`;
            case "blockquote":
                return `> ${render_node_to_string(node.content, indent)}`;
            case "subtext":
                return `-# ${render_node_to_string(node.content, indent)}`;
            case "code_block": {
                const language = node.language ?? "";
                return `\`\`\`${language}\n${node.content}\n\`\`\``;
            }
            case "list":
                return node.items
                    .map((item, i) => {
                        const prefix = node.start_number ? `${node.start_number + i}. ` : "- ";
                        return indent + prefix + render_node_to_string(item, indent + "  ");
                    })
                    .join("");
            case "doc":
                return node.content.map(child => render_node_to_string(child, indent)).join("");
            default:
                throw new Error(`Cannot render node type: ${(node as markdown_node).type}`);
        }
    };

    const process_node = (node: markdown_node): void => {
        switch (node.type) {
            case "doc":
                node.content.forEach(process_node);
                break;
            case "plain":
                add_with_context(node.content);
                break;
            case "inline_code":
                add_with_context(node.content, { wrap_open: "`", wrap_close: "`" });
                break;
            case "italics":
            case "bold":
            case "underline":
            case "strikethrough":
            case "spoiler": {
                const marker = INLINE_FORMATS[node.type];
                const content_text = render_node_to_string(node.content);
                add_with_context(content_text, { wrap_open: marker, wrap_close: marker });
                break;
            }
            case "masked_link": {
                const link_text = render_node_to_string(node.content);
                const full_link = `[${link_text}](${node.target})`;
                if (current_chunk.length + full_link.length <= limit) {
                    current_chunk += full_link;
                } else {
                    add_with_context(link_text, {
                        wrap_open: "[",
                        wrap_close: `](${node.target})`,
                    });
                }
                break;
            }
            case "header":
            case "blockquote":
            case "subtext": {
                const prefix_map: Record<string, string> = {
                    header: "#".repeat((node as any).level) + " ",
                    blockquote: "> ",
                    subtext: "-# ",
                };
                const prefix = prefix_map[node.type];
                const content_text = render_node_to_string(node.content);
                const full_text = prefix + content_text + "\n";

                if (current_chunk.length + full_text.length <= limit) {
                    current_chunk += full_text;
                } else {
                    add_with_context(content_text, { wrap_open: prefix, wrap_close: "" });
                }
                break;
            }
            case "code_block": {
                const language = node.language ?? "";
                const lines = node.content.split("\n");
                const code_open = `\`\`\`${language}\n`;
                const code_close = "\n```";

                if (current_chunk.length + code_open.length + node.content.length + code_close.length <= limit) {
                    current_chunk += code_open + node.content + code_close;
                } else {
                    flush_chunk();
                    let code_chunk = code_open;

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i] + (i < lines.length - 1 ? "\n" : "");
                        if (code_chunk.length + line.length + code_close.length > limit) {
                            code_chunk += code_close;
                            chunks.push(code_chunk);
                            code_chunk = code_open + line;
                        } else {
                            code_chunk += line;
                        }
                    }
                    current_chunk = code_chunk + code_close;
                }
                break;
            }
            case "list": {
                for (let i = 0; i < node.items.length; i++) {
                    const prefix = node.start_number ? `${node.start_number + i}. ` : "- ";
                    const item_text = prefix + render_node_to_string(node.items[i], "  ");

                    if (current_chunk.length + item_text.length <= limit) {
                        current_chunk += item_text;
                    } else if (current_chunk.length > 0) {
                        flush_chunk();
                        if (item_text.length <= limit) {
                            current_chunk = item_text;
                        } else {
                            add_with_context(item_text);
                        }
                    } else {
                        add_with_context(item_text);
                    }
                }
                break;
            }
            default:
                throw new Error(`Unhandled markdown node type: ${(node as markdown_node).type}`);
        }
    };

    process_node(ast);
    flush_chunk();

    return chunks.filter(chunk => chunk.length > 0);
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

export async function get_thread_owner(thread: Discord.ThreadChannel) {
    if (unwrap(thread.parent) instanceof Discord.ForumChannel) {
        return thread.ownerId;
    } else {
        return thread.type == Discord.ChannelType.PrivateThread
            ? thread.ownerId
            : (await thread.fetchStarterMessage())! /*TODO*/.author.id;
    }
}

export function embeds_match(
    existing_embed: Discord.Embed | Discord.APIEmbed,
    new_embed_data: Discord.Embed | Discord.APIEmbed,
) {
    if (existing_embed.title !== new_embed_data.title) {
        return false;
    }

    if (existing_embed.description !== new_embed_data.description) {
        return false;
    }

    if (existing_embed.image?.url !== new_embed_data.image?.url) {
        return false;
    }

    if (existing_embed.footer?.text.trim() !== new_embed_data.footer?.text.trim()) {
        return false;
    }

    const existing_fields = existing_embed.fields ?? [];
    const new_fields = new_embed_data.fields ?? [];

    if (existing_fields.length !== new_fields.length) {
        return false;
    }

    for (let i = 0; i < existing_fields.length; i++) {
        if (
            existing_fields[i].name !== new_fields[i].name ||
            existing_fields[i].value.trim() !== new_fields[i].value.trim() ||
            existing_fields[i].inline !== new_fields[i].inline
        ) {
            return false;
        }
    }

    return true;
}

export async function with_retry<T>(fn: () => Promise<T>, max_retries = 3) {
    for (let retry = 0; retry < max_retries; retry++) {
        try {
            return await fn();
        } catch (e) {
            if (e instanceof Discord.GatewayRateLimitError) {
                assert((e.data.opcode as any) === 8);
                await delay(e.data.retry_after * 1000 + 1000);
            } else {
                throw e;
            }
        }
    }
    throw new Error(`Operation failed after ${max_retries} retries`);
}
