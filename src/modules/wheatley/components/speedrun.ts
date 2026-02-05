import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { time_to_human } from "../../../utils/strings.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { Wheatley } from "../../../wheatley.js";
import { discord_timestamp } from "../../../utils/discord.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { SelfClearingMap } from "../../../utils/containers.js";

type speedrun_join_info = {
    joined_at: number;
};

export type speedrun_entry = {
    user_id: string;
    user_name: string;
    joined_at: number;
    banned_at: number;
    duration: number;
};

export default class Speedrun extends BotComponent {
    private staff_action_log!: Discord.TextChannel;
    private recent_joins = new SelfClearingMap<Discord.Snowflake, speedrun_join_info>(30 * MINUTE, 10 * MINUTE);
    private database = this.wheatley.database.create_proxy<{
        speedrun_attempts: speedrun_entry;
    }>();

    override async on_ready() {
        this.setup_listener("guildBanAdd", this.on_guild_ban_add.bind(this));
    }

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.speedrun_attempts, { user: 1 });

        this.staff_action_log = await this.utilities.get_channel(
            this.wheatley.channels.staff_action_log.id,
            this.wheatley.channels.staff_action_log.name,
        );
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        if (member.guild.id !== this.wheatley.guild.id) {
            return;
        }
        if (member.joinedAt === null) {
            M.warn("member.joinedAt is null in speedrun");
            return;
        }
        this.recent_joins.set(member.id, {
            joined_at: member.joinedAt.getTime(),
        });
    }

    async on_guild_ban_add(ban: Discord.GuildBan) {
        if (ban.guild.id !== this.wheatley.guild.id) {
            return;
        }
        M.debug("speedrun check");
        const user = ban.user;
        const join_info = this.recent_joins.get(user.id);
        if (!join_info) {
            return;
        }
        const now = Date.now();
        const duration = now - join_info.joined_at;
        M.log("Ban speedrun", time_to_human(duration), user.id, user.tag);
        await this.database.speedrun_attempts.insertOne({
            user_id: user.id,
            user_name: user.tag,
            joined_at: join_info.joined_at,
            banned_at: now,
            duration: duration,
        });
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.speedrun_color)
            .setAuthor({
                name: `Speedrun attempt: ${user.tag}`,
                iconURL: user.displayAvatarURL(),
            })
            .setDescription(
                `User <@${user.id}> joined at ${discord_timestamp(join_info.joined_at, "T")} and` +
                    ` banned at ${discord_timestamp(now, "T")}.\n` +
                    `Final timer: ${time_to_human(duration)}.`,
            )
            .setFooter({
                text: `ID: ${user.id}`,
            })
            .setTimestamp();
        this.staff_action_log.send({ embeds: [embed] }).catch(this.wheatley.critical_error.bind(this.wheatley));
    }
}
