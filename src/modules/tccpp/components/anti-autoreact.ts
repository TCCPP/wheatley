import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { departialize } from "../../../utils/discord.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";

export default class AntiAutoreact extends BotComponent {
    obnoxious_autoreact_ids = new Set([
        "841482328693669900", // "eisie"
    ]);
    obnoxious_autoreact_names = ["eisie"];
    obnoxious_autoreact_immunity!: Set<string>;

    override async on_ready() {
        this.obnoxious_autoreact_immunity = new Set([
            "199943082441965577", // Zelis
            "551519630578024468", // Swyde
        ]);
    }

    override async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        if (reaction.message.guildId !== this.wheatley.guild.id) {
            return;
        }
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
