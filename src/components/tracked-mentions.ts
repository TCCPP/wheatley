import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { format_list, M } from "../utils.js";
import { colors, moderators_role_id, root_role_id, TCCPP_ID } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

const tracked_mentions = new Set([
    "540314034894012428", // admin role on test server
    root_role_id,
    moderators_role_id,
    "892864085006360626", // red dragon
    "970549026514698284", // wheatley
    "1013953887029444678", // dyno
]);

/**
 * Tracks certain mentions, such as mentions of root, moderators, Wheatley, etc.
 */
export default class TrackedMentions extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    async check_tracked_mention_and_notify(message: Discord.Message) {
        const mentions = [...new Set(message.mentions.roles.map(v => v.id).filter(id => tracked_mentions.has(id)))];
        if (mentions.length > 0) {
            M.log("Spotted tracked mention", message.url, message.author.id, message.author.tag);
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.color)
                .setAuthor({
                    name: `${message.author.username}#${message.author.discriminator}`,
                    iconURL: message.author.displayAvatarURL(),
                })
                .setDescription(
                    `${format_list(mentions.map(m => `<@&${m}>`))} mentioned in` +
                        ` <#${message.channel.id}> by <@${message.author.id}>\n` +
                        `[click here to jump](${message.url})`,
                )
                .setFooter({
                    text: `ID: ${message.author.id}`,
                })
                .setTimestamp();
            await this.wheatley.action_log_channel.send({ embeds: [embed] });
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
        if (message.author.id == this.wheatley.client.user!.id || message.author.bot || message.guildId != TCCPP_ID) {
            return;
        }
        if (message.mentions.roles.size > 0) {
            await this.check_tracked_mention_and_notify(message);
        }
    }
}
