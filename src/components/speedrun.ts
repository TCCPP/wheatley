import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { time_to_human } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { discord_timestamp } from "../utils/discord.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { SelfClearingMap } from "../utils/containers.js";

type speedrun_join_info = {
    joined_at: number;
};

export default class Speedrun extends BotComponent {
    private staff_action_log!: Discord.TextChannel;
    private recent_joins = new SelfClearingMap<Discord.Snowflake, speedrun_join_info>(30 * MINUTE, 10 * MINUTE);

    override async setup(commands: CommandSetBuilder) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        if (member.joinedAt === null) {
            M.warn("member.joinedAt is null in speedrun");
            return;
        }
        this.recent_joins.set(member.id, {
            joined_at: member.joinedAt.getTime(),
        });
    }

    override async on_guild_member_remove(ban: Discord.GuildBan) {
        M.debug("speedrun check");
        const user = ban.user;
        const join_info = this.recent_joins.get(user.id);
        if (!join_info) {
            return;
        }
        const now = Date.now();
        M.log("Ban speedrun", time_to_human(now - join_info.joined_at), user.id, user.tag);
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.speedrun_color)
            .setAuthor({
                name: `Speedrun attempt: ${user.tag}`,
                iconURL: user.displayAvatarURL(),
            })
            .setDescription(
                `User <@${user.id}> joined at ${discord_timestamp(join_info.joined_at, "T")} and` +
                    ` banned at ${discord_timestamp(now, "T")}.\n` +
                    `Final timer: ${time_to_human(now - join_info.joined_at)}.`,
            )
            .setFooter({
                text: `ID: ${user.id}`,
            })
            .setTimestamp();
        this.staff_action_log.send({ embeds: [embed] }).catch(this.wheatley.critical_error.bind(this.wheatley));
    }
}
