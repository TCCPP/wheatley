import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { index_of_first_not_satisfying } from "../utils/iterables.js";
import { decode_snowflake, forge_snowflake, is_media_link_embed } from "../utils/discord.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
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

type QuoteDescriptor = {
    domain: string;
    channel_id: string;
    message_id: string;
    block: boolean;
};

export default class Quote extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder(["quote", "quoteb"], EarlyReplyMode.none)
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
            assert(match.length == 5);
            const [domain, guild_id, channel_id, message_id] = match.slice(1);
            if (guild_id != this.wheatley.TCCPP.id) {
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setDescription("Error: Can only quote from TCCPP")
                            .setColor(colors.red),
                    ],
                    ephemeral_if_possible: true,
                });
            }
            await command.do_early_reply_if_slash(false);
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
                const reply = await this.do_quote(message, quote_descriptors);
                this.wheatley.register_non_command_bot_reply(
                    message,
                    reply instanceof Discord.InteractionResponse ? await reply.fetch() : reply,
                );
                await message.suppressEmbeds();
            }
        }
    }

    // TODO: In desperate need of a refactor
    async do_quote(command: TextBasedCommand | Discord.Message, messages: QuoteDescriptor[]) {
        const embeds: (Discord.EmbedBuilder | Discord.Embed)[] = [];
        const files: (Discord.AttachmentPayload | Discord.Attachment)[] = [];
        for (const { domain, channel_id, message_id, block } of messages) {
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            if (
                channel instanceof Discord.TextChannel ||
                channel instanceof Discord.ThreadChannel ||
                channel instanceof Discord.NewsChannel
            ) {
                // TODO: Handle null command.member case better...
                const member =
                    command instanceof TextBasedCommand ? await command.get_member() : unwrap(command.member);
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
                    this.wheatley.alert("quote exploit attempt");
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
                const quote_embeds = await this.utilities.make_quote_embeds(messages, {
                    requested_by: member,
                    safe_link: known_domains.has(domain),
                });
                embeds.push(...quote_embeds.embeds);
                if (quote_embeds.files) {
                    files.push(...quote_embeds.files);
                }
            } else {
                embeds.push(
                    new Discord.EmbedBuilder().setColor(colors.red).setDescription("Error: Channel not a text channel"),
                );
                this.wheatley.critical_error("Error: Channel not a text channel");
            }
        }
        if (embeds.length > 0) {
            return await command.reply({
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
