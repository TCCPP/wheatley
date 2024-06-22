import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";

export default class EmojiLog extends BotComponent {
    override async on_emoji_create(emoji: Discord.GuildEmoji) {
        await this.wheatley.channels.staff_action_log.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Emoji Created")
                    .setThumbnail(emoji.imageURL())
                    .setColor(colors.green)
                    .setDescription(`New emoji has been made: \`:${emoji.name}:\``)
                    .setFooter({
                        text: `ID: ${emoji.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }

    override async on_emoji_delete(emoji: Discord.GuildEmoji) {
        await this.wheatley.channels.staff_action_log.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Emoji Removed")
                    .setThumbnail(emoji.imageURL())
                    .setColor(colors.red)
                    .setDescription(`Emoji has been deleted: \`:${emoji.name}:\``)
                    .setFooter({
                        text: `ID: ${emoji.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }

    override async on_emoji_update(old_emoji: Discord.GuildEmoji, new_emoji: Discord.GuildEmoji) {
        await this.wheatley.channels.staff_action_log.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Emoji Updated")
                    .setThumbnail(new_emoji.imageURL())
                    .setColor(colors.red)
                    .setDescription(`Emoji \`:${old_emoji.name}:\` was changed to \`:${new_emoji.name}:\``)
                    .setFooter({
                        text: `ID: ${new_emoji.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
    }
}
