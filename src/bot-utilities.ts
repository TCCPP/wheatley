import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { M } from "./utils/debugging-and-logging.js";

import { Wheatley } from "./wheatley.js";
import { decode_snowflake, is_media_link_embed, make_url } from "./utils/discord.js";
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

type MessageData = {
    author: UserData;
    guild: string;
    channel: string;
    id: string;
    content: string;
    embeds: Discord.APIEmbed[];
    attachments: Discord.Attachment[];
};

export class BotUtilities {
    constructor(protected readonly wheatley: Wheatley) {}

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
        };
    }

    async get_media(message: MessageData) {
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

    async make_quote_embeds(
        messages_objects: (MessageData | Discord.Message)[],
        options?: quote_options,
    ): Promise<{
        embeds: (Discord.EmbedBuilder | Discord.Embed)[];
        files?: (Discord.AttachmentPayload | Discord.Attachment)[];
    }> {
        const messages = await Promise.all(
            messages_objects.map(async message_object => {
                if (message_object instanceof Discord.Message) {
                    return await this.get_raw_message_data(message_object);
                } else {
                    return message_object;
                }
            }),
        );
        assert(messages.length >= 1);
        const head = messages[0];
        const contents = options?.custom_content ?? messages.map(m => m.content).join("\n");
        const template = options?.template ?? "\n\nFrom <##> [[Jump to message]]($$)";
        const url = make_url(head);
        const template_string = template.replaceAll("##", "#" + head.channel).replaceAll("$$", url);
        const safe_link = options?.safe_link === undefined ? true : options.safe_link;
        const author = head.author;
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
            .setTimestamp(decode_snowflake(head.id));
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
            footer.push(`Message ID: ${head.id}`);
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
        const media = (await Promise.all(messages.map(this.get_media))).flat();
        // M.log(media);
        const other_embeds = messages.map(message => message.embeds.filter(e => !is_media_link_embed(e))).flat();
        // M.log(other_embeds);
        const media_embeds: Discord.EmbedBuilder[] = [];
        const attachments: (Discord.Attachment | Discord.AttachmentPayload)[] = [];
        const other_attachments: Discord.Attachment[] = messages
            .map(message => [
                ...message.attachments
                    .map(a => a)
                    .filter(a => !(a.contentType?.indexOf("image") == 0 || a.contentType?.indexOf("video") == 0)),
            ])
            .flat();
        let set_primary_image = false;
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
        if (options?.no_extra_media_embeds) {
            media_embeds.splice(0, media_embeds.length);
            other_embeds.splice(0, other_embeds.length);
            attachments.splice(0, attachments.length);
            other_attachments.splice(0, other_attachments.length);
        }
        // M.log([embed, ...media_embeds, ...other_embeds], [...attachments, ...other_attachments]);
        return {
            embeds: [embed, ...media_embeds, ...other_embeds.map(api_embed => new Discord.EmbedBuilder(api_embed))],
            files:
                attachments.length + other_attachments.length == 0 ? undefined : [...attachments, ...other_attachments],
        };
    }

    async get_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
        assert(channel instanceof Discord.TextChannel, `Channel ${channel} (${id}) not of the expected type`);
        return channel;
    }

    async get_forum_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
        assert(channel instanceof Discord.ForumChannel, `Channel ${channel} (${id}) not of the expected type`);
        return channel;
    }

    async get_thread_channel(id: string) {
        const channel = await this.wheatley.client.channels.fetch(id);
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
}
