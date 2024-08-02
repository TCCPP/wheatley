import * as Discord from "discord.js";
import { strict as assert } from "assert";

import { BotComponent } from "../bot-component.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

import { Wheatley } from "../wheatley.js";
import { colors, DAY } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { capitalize } from "../utils/strings.js";

export default class ModStats extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.add_command(
            new TextBasedCommandBuilder("modstats")
                .set_description("Moderator stats")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_user_option({
                    title: "moderator",
                    description: "Moderator",
                    required: false,
                })
                .set_handler(this.modstats.bind(this)),
        );
    }

    async get_stats(moderator: Discord.User | null, cutoff = 0) {
        const res = await this.wheatley.database.moderations
            .aggregate([
                {
                    $match: moderator
                        ? { moderator: moderator.id, issued_at: { $gte: cutoff } }
                        : { issued_at: { $gte: cutoff } },
                },
                { $group: { _id: "$type", count: { $sum: 1 } } },
            ])
            .toArray();
        const stats: Record<string, number> = {
            mute: 0,
            warn: 0,
            ban: 0,
            kick: 0,
            rolepersist: 0,
        };
        for (const { _id, count } of res as { _id: string; count: number }[]) {
            if (_id in stats) {
                stats[_id] = count;
            }
        }
        return stats;
    }

    async modstats(command: TextBasedCommand, moderator: Discord.User | null) {
        if (moderator && !(this.wheatley.is_authorized_mod(moderator) || moderator.id == this.wheatley.id)) {
            await command.reply(`<@${moderator.id}> is not a moderator`);
            return;
        }
        if (
            !this.wheatley.is_authorized_mod(command.user) &&
            command.channel_id != this.wheatley.channels.bot_spam.id
        ) {
            await command.reply(`Please use in <#${this.wheatley.channels.bot_spam.id}>`, true);
            return;
        }
        const moderator_member = moderator ? await this.wheatley.try_fetch_tccpp_member(moderator) : null;
        const stats_7d = await this.get_stats(moderator, Date.now() - 7 * DAY);
        const stats_30d = await this.get_stats(moderator, Date.now() - 30 * DAY);
        const stats_all = await this.get_stats(moderator);
        const type_map: Record<string, string> = {
            mute: "mutes",
            warn: "warns",
            ban: "bans",
            kick: "kicks",
            rolepersist: "rolepersists",
        };
        const summarize = (stats: Record<string, number>) =>
            Object.entries(stats)
                .map(([type, count]) => `${capitalize(type_map[type])}: ${count}`)
                .join("\n");
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.default)
                    .setTitle("Mod stats")
                    .setAuthor({
                        name: moderator_member ? moderator_member.displayName : "Total",
                        iconURL: moderator_member
                            ? (moderator_member.avatarURL() ?? moderator_member.displayAvatarURL())
                            : undefined,
                    })
                    .addFields(
                        {
                            name: "Last 7 days",
                            value: summarize(stats_7d),
                            inline: true,
                        },
                        {
                            name: "Last 30 days",
                            value: summarize(stats_30d),
                            inline: true,
                        },
                        {
                            name: "All time",
                            value: summarize(stats_all),
                            inline: true,
                        },
                    ),
            ],
        });
    }
}
