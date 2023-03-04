import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils.js";
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

export class AntiAutoreact extends BotComponent {
    override async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        assert(reaction.message.author != null);
        if(obnoxious_autoreact_immunity.has(reaction.message.author.id)) {
            const emoji_name = reaction.emoji.name?.toLowerCase();
            assert(emoji_name != null);
            if(obnoxious_autoreact_names.some(name => emoji_name.toLowerCase().indexOf(name) > -1)
            || obnoxious_autoreact_ids.has(reaction.emoji.id!)) {
                M.debug("Auto-react being removed");
                for(const [ id, _ ] of reaction.users.cache) {
                    reaction.users.remove(id);
                }
            }
        }
    }
}
