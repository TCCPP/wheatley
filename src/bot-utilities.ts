import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { named_id, Wheatley } from "./wheatley.js";
import { decode_snowflake, is_media_link_embed, make_url, get_thread_owner } from "./utils/discord.js";
import { unwrap } from "./utils/misc.js";
import { colors } from "./common.js";
import { is_string } from "./utils/strings.js";

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

export type MessageData = {
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
                .filter(a => a.contentType?.startsWith("image"))
                .map(a => ({
                    type: "image",
                    attachment: a,
                })),
            ...message.attachments
                .filter(a => a.contentType?.startsWith("video"))
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
        const other_attachments = message.attachments.filter(
            a => !(a.contentType?.startsWith("image") || a.contentType?.startsWith("video")),
        );
        const images = media.filter(m => m.type === "image");
        const videos = media.filter(m => m.type === "video");
        for (const video of videos) {
            attachments.push(video.attachment);
        }
        if (images.length === 1) {
            const image = images[0];
            embed.setImage(
                image.attachment instanceof Discord.Attachment ? image.attachment.url : image.attachment.attachment,
            );
        } else if (images.length > 1) {
            for (const image of images) {
                attachments.push(image.attachment);
            }
        }
        // Add stickers as attachments
        for (const sticker of message.stickers ?? []) {
            if (sticker.url) {
                attachments.push({ attachment: sticker.url, name: `${sticker.name}.png` });
            }
        }
        if (options?.no_extra_media_embeds) {
            other_embeds.splice(0, other_embeds.length);
            attachments.splice(0, attachments.length);
            other_attachments.splice(0, other_attachments.length);
        }
        const embeds = other_embeds.map(api_embed => new Discord.EmbedBuilder(api_embed));
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
        const description =
            contents + template_string + (safe_link ? "" : " ⚠️ Unexpected domain, be careful clicking this link");
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.default)
            .setAuthor({
                name: author.display_name, // already resolved
                iconURL: member?.avatarURL() ?? author.iconURL,
            })
            .setDescription(description || null)
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
                .setColor(colors.grey)
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
            files: attachments.length ? attachments : undefined,
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
        // ensure all by the same author and only last message has media or forwarded messages
        const head = messages[0];
        for (const message of messages.slice(0, -1)) {
            assert(message.author.id == head.author.id);
            assert(message.attachments.length == 0);
            assert(message.embeds.length == 0);
            assert(!message.stickers || message.stickers.length == 0);
            assert(!message.forwarded_message);
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

    async get_channel<T extends Discord.BaseChannel = Discord.TextChannel>(
        channel_info: named_id,
        case_insensitive: boolean = true,
        expected_type: Discord.ChannelType | Discord.ChannelType[] = Discord.ChannelType.GuildText,
    ): Promise<T> {
        let channel: Discord.GuildBasedChannel | null = null;

        try {
            channel = await this.wheatley.guild.channels.fetch(channel_info.id);
        } catch (e) {
            // don't throw when DiscordAPIError[50001]: Missing Access
            if (e instanceof Discord.DiscordAPIError && e.code == 50001) {
                // unknown channel
                channel = null;
            } else {
                throw e;
            }
        }

        if (this.wheatley.devmode_enabled && !channel && channel_info.name && is_string(channel_info.name)) {
            channel = this.get_channel_by_name(channel_info.name, case_insensitive) ?? null;
        }

        if (!channel) {
            throw new Error(`Channel ${channel_info.id} not found`);
        }

        const expected_types = [expected_type].flat();
        assert(
            expected_types.includes(channel.type),
            `Channel ${channel.name} (${channel_info.id}) not of the expected type (${channel.type})`,
        );
        return <T>(<unknown>channel);
    }

    async get_forum_channel<T extends Discord.BaseChannel = Discord.ForumChannel>(channel_info: named_id) {
        return await this.get_channel<T>(channel_info, true, Discord.ChannelType.GuildForum);
    }

    async get_thread_channel<T extends Discord.BaseChannel = Discord.ThreadChannel>(channel_info: named_id) {
        return await this.get_channel<T>(channel_info, true, [
            Discord.ChannelType.PublicThread,
            Discord.ChannelType.PrivateThread,
            Discord.ChannelType.AnnouncementThread,
        ]);
    }

    async get_category<T extends Discord.BaseChannel = Discord.CategoryChannel>(channel_info: named_id) {
        return await this.get_channel<T>(channel_info, false, Discord.ChannelType.GuildCategory);
    }

    async can_user_control_thread(user: Discord.User, thread: Discord.ThreadChannel) {
        try {
            const owner_id = await get_thread_owner(thread);
            return (
                owner_id === user.id ||
                (await this.wheatley.check_permissions(user, Discord.PermissionFlagsBits.ManageThreads))
            );
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code == 10008) {
                // unknown message
                return false;
            } else {
                throw e;
            }
        }
    }

    // case-insensitive
    get_channel_by_name(name: string, case_insensitive: boolean = true) {
        return this.wheatley.guild.channels.cache.find(channel => {
            if (case_insensitive) {
                return channel.name.toLowerCase() === name.toLowerCase();
            }

            return channel.name === name;
        });
    }

    // case-insensitive
    get_role_by_name(name: string) {
        return this.wheatley.guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase());
    }
}
