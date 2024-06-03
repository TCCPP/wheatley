import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { departialize } from "../utils/discord.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { has_media } from "./autoreact.js";

export default class AntiSelfStar extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    /*override async on_ready() {
        await this.catch_up();
    }

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser
    ) {
        const message = reaction.message;
        if(!message.author) {
            M.warn("message.author is null");
        }
        if(message.channelId == memes_channel_id && user.id == message.author?.id && has_media(message)) {
            M.debug("Deleting self-starred message", [ message.author.id, message.author.tag ]);
            await message.delete();
        }
    }

    async check_message(message: Discord.Message) {
        if(message.channelId == memes_channel_id) {
            for(const [ _, reaction ] of message.reactions.cache) {
                const users = await reaction.users.fetch();
                for(const [ id, _ ] of users) {
                    if(id == message.author.id && has_media(message)) {
                        M.debug("Deleting self-starred message", [ message.author.id, message.author.tag ]);
                        await message.delete();
                    }
                }
            }
        }
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage
    ) {
        await this.check_message(await departialize(new_message));
    }

    async catch_up() {
        const TCCPP = await this.wheatley.client.guilds.fetch(TCCPP_ID);
        const memes_channel = await TCCPP.channels.fetch(memes_channel_id);
        assert(memes_channel);
        assert(memes_channel.type == Discord.ChannelType.GuildText);
        const messages = await memes_channel.messages.fetch({ limit: 100, cache: false });
        for(const [ _, message ] of messages) {
            await this.check_message(message);
        }
        M.log("Finished catching up on #memes messages");
    }*/
}
