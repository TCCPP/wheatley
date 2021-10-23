import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { obnoxious_autoreact_ids, obnoxious_autoreact_immunity, obnoxious_autoreact_names } from "./common";
import { M } from "./utils";

function on_react(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
	assert(reaction.message.author != null);
	if(obnoxious_autoreact_immunity.has(reaction.message.author.id)) {
		const emoji_name = reaction.emoji.name?.toLowerCase();
		assert(emoji_name != null);
		if(obnoxious_autoreact_names.some(name => emoji_name.indexOf(name) > -1)
		|| obnoxious_autoreact_ids.has(reaction.emoji.id!)) {
			M.debug("Auto-react being removed");
			for(let [id, _] of reaction.users.cache) {
				reaction.users.remove(id);
			}
		}
	}
}

export function setup_anti_autoreact(client: Discord.Client) {
	M.debug("Setting up anti-autoreact");
	client.on("messageReactionAdd", on_react);
}
