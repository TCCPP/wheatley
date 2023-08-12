import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, departialize } from "../utils.js";
import { BotComponent } from "../bot-component.js";

/**
 * Prevents some auto-reactions being placed on some users.
 */
export default class AntiAutoreact extends BotComponent {
    obnoxious_autoreact_ids = new Set([
        "841482328693669900", // "eisie"
    ]);
    obnoxious_autoreact_names = ["eisie"];
    obnoxious_autoreact_immunity: Set<string>;

    override async on_ready() {
        this.obnoxious_autoreact_immunity = new Set([
            this.wheatley.zelis.id,
            "551519630578024468", // Swyde
        ]);
    }

    override async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        const emoji_name = reaction.emoji.name?.toLowerCase();
        assert(emoji_name != null);
        if (
            this.obnoxious_autoreact_names.some(name => emoji_name.toLowerCase().indexOf(name) > -1) ||
            this.obnoxious_autoreact_ids.has(reaction.emoji.id!)
        ) {
            const message = await departialize(reaction.message);
            if (this.obnoxious_autoreact_immunity.has(message.author.id)) {
                M.debug("Auto-react being removed");
                await Promise.all(reaction.users.cache.map(user => reaction.users.remove(user)));
            }
        }
    }
}
