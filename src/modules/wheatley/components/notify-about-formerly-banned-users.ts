import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { build_description, pluralize, time_to_human } from "../../../utils/strings.js";
import { colors, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { discord_timestamp } from "../../../utils/discord.js";
import { moderation_entry } from "./moderation/schemata.js";
import { unwrap } from "../../../utils/misc.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import LinkedAccounts from "./linked-accounts.js";
import { BotButton } from "../../../command-abstractions/button.js";

export type notify_plugin = {
    maybe_create_button: (
        member: Discord.GuildMember,
        most_recent: moderation_entry,
    ) => Discord.ButtonBuilder | undefined;
};

export default class NotifyAboutFormerlyBannedUsers extends BotComponent {
    private staff_action_log!: Discord.TextChannel;
    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
    }>();
    private linked_accounts!: LinkedAccounts;
    private plugins: notify_plugin[] = [];

    override async setup(commands: CommandSetBuilder) {
        this.staff_action_log = await this.utilities.get_channel(this.wheatley.channels.staff_action_log);
        this.linked_accounts = unwrap(this.wheatley.components.get("LinkedAccounts")) as LinkedAccounts;
    }

    register_plugin(plugin: notify_plugin) {
        this.plugins.push(plugin);
    }

    async alert(member: Discord.GuildMember, most_recent: moderation_entry, linked_accounts: Set<string>) {
        const action = most_recent.type == "kick" ? "kicked" : "banned";
        const description_parts = [
            `User <@${member.user.id}> was previously ${action} on ${discord_timestamp(most_recent.issued_at)}`,
            most_recent.reason ? `Reason: ${most_recent.reason}` : null,
        ];
        if (linked_accounts.size > 0) {
            const account_mentions = Array.from(linked_accounts)
                .map(id => `<@${id}>`)
                .join(", ");
            description_parts.push(`⚠️ User has ${linked_accounts.size} linked accounts: ${account_mentions}`);
        }
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.alert_color)
            .setAuthor({
                name: `Previously ${action} user re-joined: ${member.user.tag}`,
                iconURL: member.user.displayAvatarURL(),
            })
            .setDescription(build_description(...description_parts))
            .setFooter({
                text: `ID: ${member.id}`,
            })
            .setTimestamp();
        const components = (() => {
            const buttons = this.plugins
                .map(plugin => plugin.maybe_create_button(member, most_recent))
                .filter(x => x !== undefined);
            return buttons.length > 0
                ? [new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(...buttons)]
                : undefined;
        })();
        await this.staff_action_log.send({
            embeds: [embed],
            components,
        });
    }

    async find_most_recent_kick_or_ban(user_ids: string[]) {
        return await this.database.moderations.findOne(
            {
                user: { $in: user_ids },
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
        if (member.guild.id !== this.wheatley.guild.id) {
            return;
        }
        const linked_accounts = await this.linked_accounts.get_all_linked_accounts(member.id);
        const all_user_ids = [member.id, ...Array.from(linked_accounts)];

        const most_recent = await this.find_most_recent_kick_or_ban(all_user_ids);
        if (most_recent !== null) {
            await this.alert(member, most_recent, linked_accounts);
        }
    }
}
