import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, departialize } from "../utils.js";
import { zelis_id } from "../common.js";
import { BotComponent } from "../bot-component.js";

const obnoxious_autoreact_ids = new Set([
    "841482328693669900" // "eisie"
]);

const obnoxious_autoreact_names = [
    "eisie"
];

const obnoxious_autoreact_immunity = new Set([
    zelis_id,
    "551519630578024468" // Swyde
]);

/**
 * Prevents some auto-reactions being placed on some users.
 */
export default class AntiAutoreact extends BotComponent {
    override async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        const emoji_name = reaction.emoji.name?.toLowerCase();
        assert(emoji_name != null);
        if(obnoxious_autoreact_names.some(name => emoji_name.toLowerCase().indexOf(name) > -1)
        || obnoxious_autoreact_ids.has(reaction.emoji.id!)) {
            const message = await departialize(reaction.message);
            if(obnoxious_autoreact_immunity.has(message.author.id)) {
                M.debug("Auto-react being removed");
                await Promise.all(reaction.users.cache.map(user => reaction.users.remove(user)));
            }
        }
    }
}
