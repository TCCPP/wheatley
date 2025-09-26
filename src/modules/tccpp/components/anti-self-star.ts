import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { departialize } from "../../../utils/discord.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { has_media } from "./autoreact.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { SelfClearingSet } from "../../../utils/containers.js";
import { MINUTE } from "../../../common.js";

export default class AntiSelfStar extends BotComponent {
    laughed_at = new SelfClearingSet<string>(5 * MINUTE, MINUTE);

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ) {
        const message = reaction.message;
        if (!message.author) {
            M.warn("message.author is null");
            return;
        }
        if (reaction.emoji.name !== "⭐") {
            return;
        }
        if (
            message.channelId == this.wheatley.channels.memes &&
            user.id == message.author.id &&
            has_media(message)
        ) {
            await this.handle_self_star(await departialize(message));
        }
    }

    async handle_self_star(message: Discord.Message) {
        if (this.laughed_at.has(message.author.id)) {
            return;
        }
        assert(message.channel.isTextBased() && !(message.channel instanceof Discord.PartialGroupDMChannel));
        await message.channel.send(
            `:index_pointing_at_the_viewer: :joy: <@${message.author.id}> starred their own message`,
        );
        this.laughed_at.insert(message.author.id);
    }
}
