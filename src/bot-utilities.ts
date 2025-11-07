import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { M } from "./utils/debugging-and-logging.js";
import * as util from "util";

import { Wheatley } from "./wheatley.js";
import { decode_snowflake, is_media_link_embed, make_url, get_thread_owner } from "./utils/discord.js";
import { unwrap } from "./utils/misc.js";
import { colors } from "./common.js";

type quote_options = {
    // description template
    template?: string;
    footer?: string;
    title?: string;
    message_id_footer?: boolean;
    user_id_footer?: boolean;
    // only include one image in the single embed, omit all other media or attachments
    no_extra_media_embeds?: boolean;
    // override message content
    custom_content?: string;
    // who requested this quote to be made
    requested_by?: Discord.GuildMember;
    // is the link safe to click? (default true)
    safe_link?: boolean;
};

type MediaDescriptor = {
    type: "image" | "video";
    attachment: Discord.Attachment | { attachment: string };
};

type UserData = {
    display_name: string;
    iconURL: string;
    username: string;
    id: string;
};

export type StickerData = {
    guildId: string | null;
    id: string;
    name: string;
    format: Discord.StickerFormatType;
    url: string;
};

function sticker_map(sticker: Discord.Sticker): StickerData {
    return {
        guildId: sticker.guildId,
        id: sticker.id,
        name: sticker.name,
        format: sticker.format,
        url: sticker.url,
    };
}

type ForwardedMessageData = {
    content: string;
    embeds: Discord.APIEmbed[];
    attachments: Discord.Attachment[];
    stickers?: StickerData[];
    timestamp: number;
    author: {
        display_name: string;
        iconURL: string;
        username: string;
        id: string;
    } | null;
    url: string | null;
};

type MessageData = {
    author: UserData;
    guild: string;
    channel: string;
    id: string;
    content: string;
    embeds: Discord.APIEmbed[];
    attachments: Discord.Attachment[];
    stickers?: StickerData[];
    forwarded_message?: ForwardedMessageData | null;
};

export class BotUtilities {
    constructor(protected readonly wheatley: Wheatley) {}

    async get_snapshot_message_data(snapshot: Discord.MessageSnapshot): Promise<ForwardedMessageData> {
        return {
            author: snapshot.author
                ? {
                      display_name: await this.wheatley.get_display_name(snapshot.author),
                      iconURL: snapshot.author.avatarURL() ?? snapshot.author.displayAvatarURL(),
                      username: snapshot.author.username,
                      id: snapshot.author.id,
                  }
                : null,
            content: snapshot.content,
            embeds: snapshot.embeds.map(e => e.data),
            attachments: [...snapshot.attachments.values()],
            stickers: [...snapshot.stickers.values()].map(sticker_map),
            timestamp: snapshot.createdTimestamp,
            url: snapshot.url,
        };
    }

    async get_raw_message_data(message: Discord.Message): Promise<MessageData> {
        return {
            author: {
                display_name: await this.wheatley.get_display_name(message),
                iconURL: message.member?.avatarURL() ?? message.author.displayAvatarURL(),
                username: message.author.username,
                id: message.author.id,
            },
            guild: message.guildId ?? "",
            channel: message.channelId,
            id: message.id,
            content: message.content,
            embeds: message.embeds.map(embed => embed.data),
            attachments: [...message.attachments.values()],
            stickers: [...message.stickers.values()].map(sticker_map),
            forwarded_message:
                message.reference?.type === Discord.MessageReferenceType.Forward
                    ? await this.get_snapshot_message_data(unwrap(message.messageSnapshots.first()))
                    : null,
        };
    }

    async get_media(message: MessageData | ForwardedMessageData) {
        return [
            ...message.attachments
                .filter(a => a.contentType?.indexOf("image") == 0)
                .map(a => ({
                    type: "image",
                    attachment: a,
                })),
            ...message.attachments
                .filter(a => a.contentType?.indexOf("video") == 0)
                .map(a => ({
                    type: "video",
                    attachment: a,
                })),
            ...message.embeds
                .filter(is_media_link_embed)
                .map(e => {
                    // Ignore video embeds for now and just defer to a thumbnail. Video embeds come from
                    // links, such as youtube or imgur etc., but embedded that as the bot would be tricky.
                    // Either the video would have to be downloaded and attached (which may be tricky or
                    // tos-violating e.g. in youtube's case) or the link could be shoved in the content for
                    // auto-embedding but then the quote interface will be tricky to work (and it might not
                    // look good).
                    if (e.image || e.thumbnail) {
                        // Webp can be thumbnail only, no image. Very weird.
                        return {
                            type: "image",
                            attachment: {
                                attachment: unwrap(e.image ? e.image : e.thumbnail).url,
                            } as Discord.AttachmentPayload,
                        };
                    } else if (e.video) {
                        // video but no thumbnail? just fallthrough...
                    } else {
                        assert(false);
                    }
                })
                .filter(x => x !== undefined),
        ] as MediaDescriptor[];
    }

    async set_up_embeds_and_attachments(
        message: MessageData | ForwardedMessageData,
        options: quote_options | undefined,
        embed: Discord.EmbedBuilder,
    ): Promise<[Discord.EmbedBuilder[], (Discord.Attachment | Discord.AttachmentPayload)[]]> {
        const media = await this.get_media(message);
        const other_embeds = message.embeds.filter(e => !is_media_link_embed(e));
        const attachments: (Discord.Attachment | Discord.AttachmentPayload)[] = [];
        const other_attachments: Discord.Attachment[] = message.attachments
            .map(a => a)
            .filter(a => !(a.contentType?.indexOf("image") == 0 || a.contentType?.indexOf("video") == 0));
        let set_primary_image = false;
        const media_embeds: Discord.EmbedBuilder[] = [];
        if (media.length > 0) {
            for (const medium of media) {
                if (medium.type == "image") {
                    if (!set_primary_image) {
                        embed.setImage(
                            medium.attachment instanceof Discord.Attachment
                                ? medium.attachment.url
                                : medium.attachment.attachment,
                        );
                        set_primary_image = true;
                    } else {
                        media_embeds.push(
                            new Discord.EmbedBuilder({
                                image: {
                                    url:
                                        medium.attachment instanceof Discord.Attachment
                                            ? medium.attachment.url
                                            : medium.attachment.attachment,
                                },
                            }),
                        );
                    }
                } else {
                    // video
                    attachments.push(medium.attachment);
                }
            }
        }
        for (const sticker of message.stickers ?? []) {
            if (sticker.url) {
                media_embeds.push(
                    new Discord.EmbedBuilder({
                        image: { url: sticker.url },
                    }),
                );
            }
        }
        if (options?.no_extra_media_embeds) {
            media_embeds.splice(0, media_embeds.length);
            other_embeds.splice(0, other_embeds.length);
            attachments.splice(0, attachments.length);
            other_attachments.splice(0, other_attachments.length);
        }
        const embeds = [...media_embeds, ...other_embeds.map(api_embed => new Discord.EmbedBuilder(api_embed))];
        const files = [...attachments, ...other_attachments];
        return [embeds, files];
    }

    async make_quote_embeds(
        message_object: MessageData | Discord.Message,
        options?: quote_options,
    ): Promise<{
        embeds: (Discord.EmbedBuilder | Discord.Embed)[];
        files?: (Discord.AttachmentPayload | Discord.Attachment)[];
    }> {
        const message =
            message_object instanceof Discord.Message
                ? await this.get_raw_message_data(message_object)
                : message_object;
        const contents = options?.custom_content ?? message.content;
        const template = options?.template ?? "\n\nFrom <##> [[Jump to message]]($$)";
        const url = make_url(message);
        const template_string = template.replaceAll("##", "#" + message.channel).replaceAll("$$", url);
        const safe_link = options?.safe_link === undefined ? true : options.safe_link;
        const author = message.author;
        const member = await this.wheatley.try_fetch_guild_member(author.id);
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.default)
            .setAuthor({
                name: author.display_name, // already resolved
                iconURL: member?.avatarURL() ?? author.iconURL,
            })
            .setDescription(
                contents + template_string + (safe_link ? "" : " ⚠️ Unexpected domain, be careful clicking this link"),
            )
            .setTimestamp(decode_snowflake(message.id));
        if (options?.requested_by) {
            embed.setFooter({
                text: `Quoted by ${options.requested_by.displayName}`,
                iconURL: options.requested_by.user.displayAvatarURL(),
            });
        }
        if (options?.footer) {
            embed.setFooter({
                text: options.footer,
            });
        }
        const footer: string[] = [];
        if (options?.message_id_footer) {
            footer.push(`Message ID: ${message.id}`);
        }
        if (options?.user_id_footer) {
            footer.push(`User ID: ${author.id}`);
        }
        if (footer.length > 0) {
            embed.setFooter({
                text: footer.join(" | "),
            });
        }
        if (options?.title) {
            embed.setTitle(options.title);
        }
        const [extra_embeds, attachments] = await this.set_up_embeds_and_attachments(message, options, embed);
        if (message.forwarded_message) {
            const embed = new Discord.EmbedBuilder()
                .setTitle("Forwarded Message")
                .setColor(colors.alert_color)
                .setDescription(
                    message.forwarded_message.content +
                        (message.forwarded_message.url
                            ? `\n\n[[Jump to message source]](${message.forwarded_message.url})`
                            : ""),
                )
                .setTimestamp(decode_snowflake(message.id));
            if (message.forwarded_message.author) {
                embed.setAuthor({
                    name: author.display_name, // already resolved
                    iconURL: member?.avatarURL() ?? author.iconURL,
                });
            }
            const [forward_embeds, forward_attachments] = await this.set_up_embeds_and_attachments(
                message.forwarded_message,
                options,
                embed,
            );
            extra_embeds.push(embed, ...forward_embeds);
            attachments.push(...forward_attachments);
        }
        return {
            embeds: [embed, ...extra_embeds],
            files: attachments.length ? undefined : attachments,
        };
    }

    async make_quote_embeds_multi_message(
        message_objects: (MessageData | Discord.Message)[],
        options?: quote_options,
    ): Promise<{
        embeds: (Discord.EmbedBuilder | Discord.Embed)[];
        files?: (Discord.AttachmentPayload | Discord.Attachment)[];
    }> {
        const messages = await Promise.all(
            message_objects.map(async message_object => {
                if (message_object instanceof Discord.Message) {
                    return await this.get_raw_message_data(message_object);
                } else {
                    return message_object;
                }
            }),
        );
        assert(messages.length >= 1);
        // ensure all by the same author and only last message has media
        const head = messages[0];
        for (const message of messages.slice(0, -1)) {
            assert(message.author.id == head.author.id);
            assert(message.attachments.length == 0);
            assert(message.embeds.length == 0);
            assert(!message.stickers || message.stickers.length == 0);
            assert(message.forwarded_message);
        }
        return await this.make_quote_embeds(
            {
                author: head.author,
                guild: head.guild,
                channel: head.channel,
                id: head.id,
                content: messages.map(m => m.content).join("\n"),
                embeds: unwrap(messages.at(-1)).embeds,
                attachments: unwrap(messages.at(-1)).attachments,
                stickers: unwrap(messages.at(-1)).stickers,
                forwarded_message: unwrap(messages.at(-1)).forwarded_message,
            },
            options,
        );
    }

    async get_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
        if (!channel) {
            throw Error(`Channel ${id} not found`);
        }
        assert(channel instanceof Discord.TextChannel, `Channel ${channel} (${id}) not of the expected type`);
        return channel;
    }

    async get_forum_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
        if (!channel) {
            throw Error(`Forum channel ${id} not found`);
        }
        assert(channel instanceof Discord.ForumChannel, `Channel ${channel} (${id}) not of the expected type`);
        return channel;
    }

    async get_thread_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
        if (!channel) {
            throw Error(`Thread channel ${id} not found`);
        }
        assert(channel instanceof Discord.ThreadChannel, `Channel ${channel} (${id}) not of the expected type`);
        return channel;
    }

    async get_category(id: string) {
        const category = await this.wheatley.client.channels.fetch(id);
        if (!category) {
            throw Error(`Category ${id} not found`);
        }
        assert(category instanceof Discord.CategoryChannel, `Category ${category} (${id}) not of the expected type`);
        return category;
    }

    async can_user_control_thread(user: Discord.User, thread: Discord.ThreadChannel) {
        const owner_id = await get_thread_owner(thread);
        return (
            owner_id === user.id ||
            (await this.wheatley.check_permissions(user, Discord.PermissionFlagsBits.ManageThreads))
        );
    }
}
