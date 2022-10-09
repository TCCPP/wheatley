import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utility/utils";
import { zelis_id } from "../common";

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

function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
    try {
        assert(reaction.message.author != null);
        if(obnoxious_autoreact_immunity.has(reaction.message.author.id)) {
            const emoji_name = reaction.emoji.name?.toLowerCase();
            assert(emoji_name != null);
            if(obnoxious_autoreact_names.some(name => emoji_name.toLowerCase().indexOf(name) > -1)
            || obnoxious_autoreact_ids.has(reaction.emoji.id!)) {
                M.debug("Auto-react being removed");
                for(const [id, _] of reaction.users.cache) {
                    reaction.users.remove(id);
                }
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

export function setup_anti_autoreact(client: Discord.Client) {
    try {
        M.debug("Setting up anti-autoreact");
        client.on("messageReactionAdd", on_react);
    } catch(e) {
        critical_error(e);
    }
}
