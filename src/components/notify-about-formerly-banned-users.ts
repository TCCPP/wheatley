import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { build_description, time_to_human } from "../utils/strings.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { discord_timestamp } from "../utils/discord.js";
import { moderation_entry } from "./moderation/schemata.js";
import { unwrap } from "../utils/misc.js";

export default class NotifyAboutFormerlyBannedUsers extends BotComponent {
    private staff_action_log: Discord.TextChannel;
    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
    }>();

    override async setup(commands: any) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
    }

    async alert(member: Discord.GuildMember, most_recent: moderation_entry) {
        const action = most_recent.type == "kick" ? "kicked" : "banned";
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.alert_color)
            .setAuthor({
                name: `Previously ${action} user re-joined: ${member.user.tag}`,
                iconURL: member.user.displayAvatarURL(),
            })
            .setDescription(
                build_description(
                    `User <@${member.user.id}> was previously ${action} on ${discord_timestamp(most_recent.issued_at)}`,
                    most_recent.reason ? `Reason: ${most_recent.reason}` : null,
                ),
            )
            .setFooter({
                text: `ID: ${member.id}`,
            })
            .setTimestamp();
        await this.staff_action_log.send({ embeds: [embed] });
    }

    async find_most_recent_kick_or_ban(member: Discord.GuildMember) {
        return await this.database.moderations.findOne(
            {
                user: member.id,
                $or: [{ type: "ban" }, { type: "softban" }, { type: "kick" }],
                expunged: null,
            },
            {
                sort: {
                    issued_at: -1,
                },
            },
        );
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        const most_recent = await this.find_most_recent_kick_or_ban(member);
        if (most_recent !== null) {
            await this.alert(member, most_recent);
        }
    }
}
