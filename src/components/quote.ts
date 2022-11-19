import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, index_of_first_not_satisfying, is_image_link_embed, M } from "../utils";
import { MINUTE, TCCPP_ID } from "../common";
import { decode_snowflake, forge_snowflake } from "./snowflake";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command";

// https://discord.com/channels/331718482485837825/802541516655951892/877257002584252426
//                              guild              channel            message
const raw_url_re = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const url_re = new RegExp(`^${raw_url_re.source}$`, "i");
const implicit_quote_re = new RegExp(`\\[${raw_url_re.source}(b?)\\]`, "gi");

const color = 0x7E78FE; //0xA931FF;

type QuoteDescriptor = {
    channel_id: string;
    message_id: string;
    block: boolean;
};

export class Quote extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder([ "quote", "quoteb" ])
                .set_description([ "Quote a message", "Quote a block of messages" ])
                .add_string_option({
                    title: "url",
                    description: "url",
                    required: true
                })
                .set_handler(this.quote.bind(this))
        );
    }

    async quote(command: TextBasedCommand, url: string) {
        const match = url.trim().match(url_re);
        if(match != null) {
            M.log("Received quote command", command.user.tag, command.user.id, url, command.get_or_forge_url());
            assert(match.length == 4);
            const [ guild_id, channel_id, message_id ] = match.slice(1);
            if(guild_id == TCCPP_ID) {
                await this.do_quote(command, [{
                    channel_id,
                    message_id,
                    block: command.name == "quoteb"
                }]);
            }
        } else {
            command.reply("Usage: `!quote <url>`\n"
                        + "`!quoteb` can be used to quote a continuous block of messages", true);
        }
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
        if(message.content.includes("[https://")) {
            // if the message might contain a link, look at it
            const quote_descriptors = [...message.content.matchAll(implicit_quote_re)]
                .filter(([ _, guild_id ]) => guild_id == TCCPP_ID)
                .map(arr => arr.slice(2))
                .map(([ channel_id, message_id, block_flag ]) => ({
                    channel_id,
                    message_id,
                    block: block_flag == "b"
                }));
            if(quote_descriptors.length >= 1) {
                M.log(
                    "Implicit quote request",
                    message.author.tag,
                    message.author.id,
                    ...quote_descriptors.map(d => `${d.channel_id}/${d.message_id}` + (d.block ? " block" : "")),
                    message.url
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

    // TODO: Redundant with server_suggestion_tracker
    async get_display_name(thing: Discord.Message | Discord.User): Promise<string> {
        if(thing instanceof Discord.User) {
            const user = thing;
            try {
                return (await this.wheatley.TCCPP.members.fetch(user.id)).displayName;
            } catch {
                // user could potentially not be in the server
                return user.tag;
            }
        } else if(thing instanceof Discord.Message) {
            const message = thing;
            if(message.member == null) {
                return this.get_display_name(message.author);
            } else {
                return message.member.displayName;
            }
        } else {
            assert(false);
        }
    }

    async make_quote(messages: Discord.Message[], requested_by: Discord.GuildMember) {
        assert(messages.length >= 1);
        const head = messages[0];
        const contents = messages.map(m => m.content).join("\n");
        const embed = new Discord.EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${await this.get_display_name(head)}`,
                iconURL: head.author.displayAvatarURL()
            })
            .setDescription(contents + `\n\nFrom <#${head.channel.id}> [[Jump to message]](${head.url})`)
            .setTimestamp(head.createdAt)
            .setFooter({
                text: `Quoted by ${requested_by.displayName}`,
                iconURL: requested_by.user.displayAvatarURL()
            });
        const images = messages.map(message => [
            ...message.attachments.filter(a => a.contentType?.indexOf("image") == 0).map(a => a.url),
            ...message.embeds.filter(is_image_link_embed).map(e => e.url!)
        ]).flat();
        const other_embeds = messages.map(message => message.embeds.filter(e => !is_image_link_embed(e))).flat();
        const image_embeds: Discord.EmbedBuilder[] = [];
        if(images.length > 0) {
            embed.setImage(images[0]);
            for(const image of images.slice(1)) {
                image_embeds.push(new Discord.EmbedBuilder({
                    image: {
                        url: image
                    }
                }));
            }
        }
        return [ embed, ...image_embeds, ...other_embeds ];
    }

    async do_quote(command: TextBasedCommand, messages: QuoteDescriptor[]) {
        const embeds: (Discord.EmbedBuilder | Discord.Embed)[] = [];
        for(const { channel_id, message_id, block } of messages) {
            const channel = await this.wheatley.TCCPP.channels.fetch(channel_id);
            if(channel instanceof Discord.TextChannel
            || channel instanceof Discord.ThreadChannel
            || channel instanceof Discord.NewsChannel) {
                let messages: Discord.Message[] = [];
                if(block) {
                    const fetched_messages = (await channel.messages.fetch({
                        after: forge_snowflake(decode_snowflake(message_id) - 1),
                        limit: 50
                    })).map(m => m).reverse();
                    const start_time = fetched_messages.length > 0 ? fetched_messages[0].createdTimestamp : undefined;
                    const end = index_of_first_not_satisfying(fetched_messages,
                                                              m => m.author.id == fetched_messages[0].author.id
                                                                   && m.createdTimestamp - start_time! <= 60 * MINUTE);
                    messages = fetched_messages.slice(0, end == -1 ? fetched_messages.length : end);
                } else {
                    const quote_message = await channel.messages.fetch(message_id);
                    messages = [quote_message];
                }
                assert(messages.length >= 1);
                const quote_embeds = await this.make_quote(messages, await command.get_member());
                embeds.push(...quote_embeds);
            } else {
                embeds.push(new Discord.EmbedBuilder().setDescription("Error: Channel not a text channel"));
                critical_error("Error: Channel not a text channel");
            }
        }
        if(embeds.length > 0) {
            await command.reply({ embeds: embeds });
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
