import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";

/**
 * Responds to users attempting to ping @everyone or @here
 * with a message discouraging the behavior.
 */
export default class AntiEveryone extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message<boolean>): Promise<void> {
        if (
            // self
            message.author.id == this.wheatley.client.user!.id ||
            // bot
            message.author.bot ||
            // mod
            this.wheatley.is_authorized_mod(message.author) ||
            // outside of TCCPP (like DMs)
            message.guildId != this.wheatley.TCCPP.id
        ) {
            return;
        }
        // This covers @everyone and @here, despite its name.
        // https://old.discordjs.dev/#/docs/discord.js/main/class/MessageMentions?scrollTo=everyone
        if (message.mentions.everyone) {
            // NOTE: .toLocaleString("en-US") formats this number with commas.
            const memberCount = this.wheatley.TCCPP.members.cache.size.toLocaleString("en-US");
            await message.reply({
                content: `Did you really just try to ping ${memberCount} people?`,
            });
        }
    }
}
