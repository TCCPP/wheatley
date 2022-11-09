import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { delay, is_image_link_embed, M } from "../utils";
import { introductions_channel_id, memes_channel_id, MINUTE, server_suggestions_channel_id, TCCPP_ID } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

export class Autoreact extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        await this.catch_up();
    }

    async is_new_member(message: Discord.Message) {
        let member: Discord.GuildMember;
        if(message.member == null) {
            try {
                member = await message.guild!.members.fetch(message.author.id);
            } catch(error) {
                M.warn("failed to get user", message.author.id);
                return false;
            }
        } else {
            member = message.member;
        }
        assert(member.joinedTimestamp != null);
        return (Date.now() - member.joinedTimestamp) <= 4 * 24 * 60 * MINUTE;
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)

        //if(message.channel.id == memes_channel_id) {
        //    M.info(message.content, message.attachments, message.embeds,
        //        message.attachments.some(
        //          a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/") || false),
        //        message.embeds.some(is_image_link_embed));
        //}

        if(message.channel.id == introductions_channel_id) {
            if(message.member == null) M.warn("Why??", message); // TODO: Ping zelis?
            if(await this.is_new_member(message)) {
                await delay(1 * MINUTE);
                M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                await message.react("👋");
            }
        } else if(message.channel.id == memes_channel_id && (
            message.attachments.some(a =>
                a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/") || false)
            || message.embeds.some(is_image_link_embed)
        )) {
            M.log("adding star reaction", message.author.tag, message.author.id, message.url);
            await message.react("⭐");
        } else if(message.channel.id == server_suggestions_channel_id) {
            M.log("adding server suggestion reactions", message.author.tag, message.author.id, message.url);
            await message.react("👍");
            await message.react("👎");
        }
    }

    async catch_up() {
        const TCCPP = await this.wheatley.client.guilds.fetch(TCCPP_ID);
        const introductions_channel = await TCCPP.channels.fetch(introductions_channel_id);
        assert(introductions_channel);
        assert(introductions_channel.type == Discord.ChannelType.GuildText);
        const messages = await introductions_channel.messages.fetch({ limit: 100, cache: false });
        for(const [ _, message ] of messages) {
            if(await this.is_new_member(message)) {
                M.log("Waving to new user", message.author.tag, message.author.id, message.url);
                message.react("👋");
            }
        }
        M.log("finished catching up on introduction messages");
    }
}
