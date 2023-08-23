import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, index_of_first_not_satisfying, is_media_link_embed, M, unwrap } from "../utils.js";
import { colors, MINUTE } from "../common.js";
import { decode_snowflake, forge_snowflake } from "./snowflake.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

// https://discord.com/channels/331718482485837825/802541516655951892/877257002584252426
//                              guild              channel            message
// Discord uses many domains and subdomains:
// - discord.com
// - ptb.discord.com
// - canary.discord.com
// - discordapp.com
// - and maybe more and I'm sure they'll use others in the future
// We'll just match anything containing `discord` followed by /channels/id/id/id
const raw_url_re = /https:\/\/(.*discord.*)\/channels\/(\d+)\/(\d+)\/(\d+)/;
const known_domains = new Set(["discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com"]);
export const url_re = new RegExp(`^${raw_url_re.source}$`, "i");
const implicit_quote_re = new RegExp(`\\[${raw_url_re.source}(b?)\\]`, "gi");

const color = 0x7e78fe; //0xA931FF;

type QuoteDescriptor = {
    domain: string;
    channel_id: string;
    message_id: string;
    block: boolean;
};

// TODO: Redundant with server_suggestion_tracker
async function get_display_name(thing: Discord.Message | Discord.User, wheatley: Wheatley): Promise<string> {
    if (thing instanceof Discord.User) {
        const user = thing;
        try {
            return (await wheatley.TCCPP.members.fetch(user.id)).displayName;
        } catch {
            // user could potentially not be in the server
            return user.tag;
        }
    } else if (thing instanceof Discord.Message) {
        const message = thing;
        if (message.member == null) {
            return get_display_name(message.author, wheatley);
        } else {
            return message.member.displayName;
        }
    } else {
        assert(false);
    }
}

function filename(url: string) {
    return url.split("/").at(-1);
}

export async function make_quote_embeds(
    messages: Discord.Message[],
    requested_by: Discord.GuildMember | undefined,
    wheatley: Wheatley,
    safe_link: boolean,
    template = "\n\nFrom <##> [[Jump to message]]($$)",
): Promise<{
    embeds: (Discord.EmbedBuilder | Discord.Embed)[];
    files?: Discord.AttachmentPayload[];
}> {
    assert(messages.length >= 1);
    const head = messages[0];
    const contents = messages.map(m => m.content).join("\n");
    const template_string = template.replaceAll("##", "#" + head.channel.id).replaceAll("$$", head.url);
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: `${await get_display_name(head, wheatley)}`,
            iconURL: head.member?.avatarURL() ?? head.author.displayAvatarURL(),
        })
        .setDescription(
            contents + template_string + (safe_link ? "" : " ⚠️ Unexpected domain, be careful clicking this link"),
        )
        .setTimestamp(head.createdAt);
    if (requested_by) {
        embed.setFooter({
            text: `Quoted by ${requested_by.displayName}`,
            iconURL: requested_by.user.displayAvatarURL(),
        });
    }
    type MediaDescriptor = {
        type: "image" | "video";
        url: string;
    };
    const media: MediaDescriptor[] = messages
        .map(
            message =>
                [
                    ...message.attachments
                        .filter(a => a.contentType?.indexOf("image") == 0)
                        .map(a => ({
                            type: "image",
                            url: a.url,
                        })),
                    ...message.attachments
                        .filter(a => a.contentType?.indexOf("video") == 0)
                        .map(a => ({
                            type: "video",
                            url: a.url,
                            additional_data: {
                                width: a.width,
                                height: a.height,
                            },
                        })),
                    ...message.embeds.filter(is_media_link_embed).map(e => {
                        if (e.image || e.thumbnail) {
                            // Webp can be thumbnail only, no image. Very weird.
                            return {
                                type: "image",
                                url: unwrap(unwrap(e.image || e.thumbnail).url),
                            };
                        } else if (e.video) {
                            return {
                                type: "video",
                                url: unwrap(e.video.url),
                            };
                        } else {
                            assert(false);
                        }
                    }),
                ] as MediaDescriptor[],
        )
        .flat();
    const other_embeds = messages.map(message => message.embeds.filter(e => !is_media_link_embed(e))).flat();
    const media_embeds: Discord.EmbedBuilder[] = [];
    const attachments: Discord.AttachmentPayload[] = [];
    const other_attachments: Discord.AttachmentPayload[] = messages
        .map(message => [
            ...message.attachments
                .filter(a => !(a.contentType?.indexOf("image") == 0 || a.contentType?.indexOf("video") == 0))
                .map(a => ({
                    attachment: a.url,
                    name: filename(a.url),
                })),
        ])
        .flat();
    let set_primary_image = false;
    if (media.length > 0) {
        for (const medium of media) {
            if (medium.type == "image") {
                if (!set_primary_image) {
                    embed.setImage(medium.url);
                    set_primary_image = true;
                } else {
                    media_embeds.push(
                        new Discord.EmbedBuilder({
                            image: {
                                url: medium.url,
                            },
                        }),
                    );
                }
            } else {
                // video
                attachments.push({
                    attachment: medium.url,
                    name: filename(medium.url),
                });
            }
        }
    }
    return {
        embeds: [embed, ...media_embeds, ...other_embeds],
        files: attachments.length + other_attachments.length == 0 ? undefined : [...attachments, ...other_attachments],
    };
}

/**
 * Adds a /quote command for quoting messages within TCCPP.
 */
export default class Quote extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder(["quote", "quoteb"])
                .set_description(["Quote a message", "Quote a block of messages"])
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true,
                })
                .set_handler(this.quote.bind(this)),
        );
    }

    async quote(command: TextBasedCommand, url: string) {
        const match = url.trim().match(url_re);
        if (match != null) {
            M.log("Received quote command", command.user.tag, command.user.id, url, command.get_or_forge_url());
            assert(match.length == 5);
            const [domain, guild_id, channel_id, message_id] = match.slice(1);
            if (guild_id == this.wheatley.TCCPP.id) {
                await this.do_quote(command, [
                    {
                        domain,
                        channel_id,
                        message_id,
                        block: command.name == "quoteb",
                    },
                ]);
            } else {
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setDescription("Error: Can only quote from TCCPP")
                            .setColor(colors.red),
                    ],
                    ephemeral_if_possible: true,
                });
            }
        } else {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setDescription(
                            "Usage: `!quote <url>`\n" + "`!quoteb` can be used to quote a continuous block of messages",
                        )
                        .setColor(colors.red),
                ],
                ephemeral_if_possible: true,
            });
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
        if (
            message.author.id == this.wheatley.client.user!.id ||
            message.author.bot ||
            message.guildId != this.wheatley.TCCPP.id
        ) {
            return;
        }
        if (message.content.includes("[https://")) {
            // if the message might contain a link, look at it
            const quote_descriptors = [...message.content.matchAll(implicit_quote_re)]
                .filter(([_full, _domain, guild_id]) => guild_id == this.wheatley.TCCPP.id)
                .map(arr => arr.slice(1))
                .map(([domain, _, channel_id, message_id, block_flag]) => ({
                    domain,
                    channel_id,
                    message_id,
                    block: block_flag == "b",
                }));
            if (quote_descriptors.length >= 1) {
                M.log(
                    "Implicit quote request",
                    message.author.tag,
                    message.author.id,
                    ...quote_descriptors.map(d => `${d.channel_id}/${d.message_id}` + (d.block ? " block" : "")),
                    message.url,
                );
                const command = new TextBasedCommand("quote", message, this.wheatley);
                await this.do_quote(command, quote_descriptors);
                const reply = command.get_reply();
                assert(reply instanceof Discord.Message);
                this.wheatley.make_deletable(message, reply);
                await message.suppressEmbeds();
            }
        }
    }

    async do_quote(command: TextBasedCommand, messages: QuoteDescriptor[]) {
        const embeds: (Discord.EmbedBuilder | Discord.Embed)[] = [];
        const files: Discord.AttachmentPayload[] = [];
        for (const { domain, channel_id, message_id, block } of messages) {
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            if (
                channel instanceof Discord.TextChannel ||
                channel instanceof Discord.ThreadChannel ||
                channel instanceof Discord.NewsChannel
            ) {
                const member = await command.get_member();
                const permissions = [
                    channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.ViewChannel),
                    channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.ReadMessageHistory),
                ];
                if (!permissions.every(b => b)) {
                    embeds.push(
                        new Discord.EmbedBuilder()
                            .setColor(colors.red)
                            .setDescription("Error: You don't have permissions for that channel"),
                    );
                    await this.wheatley.zelis.send("quote exploit attempt");
                    continue;
                }
                let messages: Discord.Message[] = [];
                if (block) {
                    const fetched_messages = (
                        await channel.messages.fetch({
                            after: forge_snowflake(decode_snowflake(message_id) - 1),
                            limit: 50,
                        })
                    )
                        .map(m => m)
                        .reverse();
                    const start_time = fetched_messages.length > 0 ? fetched_messages[0].createdTimestamp : undefined;
                    const end = index_of_first_not_satisfying(
                        fetched_messages,
                        m =>
                            m.author.id == fetched_messages[0].author.id &&
                            m.createdTimestamp - start_time! <= 60 * MINUTE,
                    );
                    messages = fetched_messages.slice(0, end == -1 ? fetched_messages.length : end);
                } else {
                    const quote_message = await channel.messages.fetch(message_id);
                    messages = [quote_message];
                }
                assert(messages.length >= 1);
                const quote_embeds = await make_quote_embeds(
                    messages,
                    member,
                    this.wheatley,
                    known_domains.has(domain),
                );
                embeds.push(...quote_embeds.embeds);
                if (quote_embeds.files) {
                    files.push(...quote_embeds.files);
                }
            } else {
                embeds.push(
                    new Discord.EmbedBuilder().setColor(colors.red).setDescription("Error: Channel not a text channel"),
                );
                critical_error("Error: Channel not a text channel");
            }
        }
        if (embeds.length > 0) {
            await command.reply({
                embeds: embeds,
                files: files.length == 0 ? undefined : files,
            });
            // log
            // TODO: Can probably improve how this is done. Figure out later.
            /*this.wheatley.staff_message_log.send({
                content: "Message quoted"
                        + `\nIn <#${command.channel_id}> ${command.get_or_forge_url()}`
                        + `\nFrom <#${channel_id}> ${messages[0].url}`
                        + `\nBy ${command.user.tag} ${command.user.id}`,
                embeds
            });*/
        } else {
            throw "No quote embeds";
        }
    }
}
