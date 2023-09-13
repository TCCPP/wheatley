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
            await message.channel.send({
                content: `<@${message.author}>`,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setTitle("Don't ping Everyone!")
                        .setDescription(
                            // FIXME: this message might need to be re-worded
                            'Pinging "everyone" (or "here") is not allowed in this server. ' +
                                "These pings are disruptive to a large quantity of users.",
                        ),
                ],
            });
        }
    }
}
