import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { format_list } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

/**
 * Tracks certain mentions, such as mentions of root, moderators, Wheatley, etc.
 */
export default class TrackedMentions extends BotComponent {
    private staff_action_log: Discord.TextChannel;
    tracked_mentions: Set<string>;

    override async setup(commands: any) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
    }

    override async on_ready() {
        this.tracked_mentions = new Set([
            "540314034894012428", // admin role on test server
            this.wheatley.roles.root.id,
            this.wheatley.roles.moderators.id,
            "892864085006360626", // red dragon
            "970549026514698284", // wheatley
            "1013953887029444678", // dyno
        ]);
    }

    async check_tracked_mention_and_notify(message: Discord.Message) {
        const mentions = [
            ...new Set(message.mentions.roles.map(v => v.id).filter(id => this.tracked_mentions.has(id))),
        ];
        if (mentions.length > 0) {
            M.log("Spotted tracked mention", message.url, message.author.id, message.author.tag);
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
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
            await this.staff_action_log.send({ embeds: [embed] });
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
        if (
            message.author.id == this.wheatley.user.id ||
            message.author.bot ||
            message.guildId != this.wheatley.guild.id
        ) {
            return;
        }
        if (message.mentions.roles.size > 0) {
            await this.check_tracked_mention_and_notify(message);
        }
    }
}
