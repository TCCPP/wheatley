import * as Discord from "discord.js";
import { strict as assert } from "assert";

import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";

import { moderation_entry } from "./schemata.js";
import { colors, DAY } from "../../../../common.js";
import { unwrap } from "../../../../utils/misc.js";
import { capitalize } from "../../../../utils/strings.js";
import { channel_map } from "../../../../channel-map.js";

export default class ModStats extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
    }>();
    private channels = channel_map(this.wheatley, this.wheatley.channels.bot_spam);

    override async setup(commands: CommandSetBuilder) {
        await this.channels.resolve();
        commands.add(
            new TextBasedCommandBuilder("modstats", EarlyReplyMode.none)
                .set_category("Moderation")
                .set_description("Moderator stats")
                .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
                .add_user_option({
                    title: "moderator",
                    description: "Moderator",
                    required: false,
                })
                .set_handler(this.modstats.bind(this)),
        );
    }

    async get_stats(moderator: Discord.User | null, cutoff = 0) {
        const res = await this.database.moderations
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
        if (command.channel_id != this.channels.bot_spam.id) {
            await command.reply(`Please use in <#${this.channels.bot_spam.id}>`, true);
            return;
        }
        await command.do_early_reply_if_slash(false);
        const moderator_member = moderator ? await this.wheatley.try_fetch_guild_member(moderator) : null;
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
