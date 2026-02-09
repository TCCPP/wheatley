import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../../../common.js";
import { delay, unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { set_interval } from "../../../utils/node.js";
import { build_description } from "../../../utils/strings.js";
import { with_retry } from "../../../utils/discord.js";
import { channel_map } from "../../../channel-map.js";
import { wheatley_channels } from "../channels.js";
import { wheatley_roles } from "../roles.js";

export type user_role_entry = {
    user_id: string;
    roles: string[];
};

type role_check = (member: Discord.GuildMember) => Promise<void>;
type role_update_callback = (member: Discord.GuildMember) => Promise<void>;
type role_update_listener = {
    roles_of_interest: Set<string>;
    callback: role_update_callback;
};

export default class RoleManager extends BotComponent {
    private channels = channel_map(this.wheatley, wheatley_channels.staff_member_log);

    // roles that will not be re-applied on join
    private do_not_restore = new Set<string>([
        // moderation roles
        wheatley_roles.muted.id,
        wheatley_roles.monke.id,
        wheatley_roles.no_off_topic.id,
        wheatley_roles.no_suggestions.id,
        wheatley_roles.no_suggestions_at_all.id,
        wheatley_roles.no_reactions.id,
        wheatley_roles.no_images.id,
        wheatley_roles.no_threads.id,
        wheatley_roles.no_serious_off_topic.id,
        wheatley_roles.no_til.id,
        wheatley_roles.no_memes.id,
        wheatley_roles.voice.id,
        // other misc roles
        wheatley_roles.featured_bot.id,
        wheatley_roles.official_bot.id,
        wheatley_roles.jedi_council.id,
        wheatley_roles.pink.id,
        wheatley_roles.herald.id,
    ]);

    interval: NodeJS.Timeout | null = null;

    // current database state
    private user_roles = new Map<string, Set<string>>();

    private database = this.wheatley.database.create_proxy<{
        user_roles: user_role_entry;
    }>();

    private role_checks: role_check[] = [];
    private role_update_listeners: role_update_listener[] = [];

    register_role_check(check: role_check) {
        this.role_checks.push(check);
    }

    register_role_update_listener(roles_of_interest: Set<string>, callback: role_update_callback) {
        this.role_update_listeners.push({ roles_of_interest: roles_of_interest, callback: callback });
    }

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.user_roles, { user_id: 1 }, { unique: true });
        await this.channels.resolve();
    }

    override async on_ready() {
        for await (const entry of this.database.user_roles.find()) {
            this.user_roles.set(entry.user_id, new Set(entry.roles));
        }

        const check = () => {
            this.check_members().catch(this.wheatley.critical_error.bind(this.wheatley));
        };
        check();
        this.interval = set_interval(check, HOUR);
    }

    async check_member_roles(member: Discord.GuildMember) {
        for (const check of this.role_checks) {
            await check(member);
        }
        const old_roles = this.user_roles.get(member.id);
        const current_roles = member.roles.cache;
        const diff = old_roles?.symmetricDifference(current_roles);
        if (diff === undefined || diff.size > 0) {
            const role_ids = current_roles.map(role => role.id);
            await this.database.user_roles.findOneAndUpdate(
                { user_id: member.id },
                { $set: { roles: role_ids } },
                { upsert: true },
            );
            const new_roles = new Set(role_ids);
            this.user_roles.set(member.id, new_roles);
            for (const { roles_of_interest, callback } of this.role_update_listeners) {
                if (!roles_of_interest.isDisjointFrom(diff ?? new_roles)) {
                    await callback(member);
                }
            }
        }
    }

    async check_members() {
        M.log("Starting role checks");
        try {
            await with_retry(async () => {
                const members = await this.wheatley.guild.members.fetch();
                for (const member of members.values()) {
                    await this.check_member_roles(member);
                }
            });
        } catch (e) {
            this.wheatley.critical_error(e);
            return;
        }
        M.log("Finished role checks");
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        if (new_member.guild.id !== this.wheatley.guild.id) {
            return;
        }
        await this.check_member_roles(new_member);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        if (member.guild.id !== this.wheatley.guild.id) {
            return;
        }
        // apply old roles
        const roles_entry = await this.database.user_roles.findOne({ user_id: member.id });
        if (roles_entry === null) {
            return;
        }
        this.wheatley.llog(this.channels.staff_member_log, {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Re-Adding roles for Member")
                    .setAuthor({
                        name: member.user.username,
                        iconURL: member.displayAvatarURL(),
                    })
                    .setThumbnail(member.displayAvatarURL())
                    .setColor(colors.default)
                    .setDescription(
                        build_description(
                            `<@${member.user.id}> ${member.user.username}`,
                            ...roles_entry.roles
                                .filter(role_id => role_id != this.wheatley.guild.id)
                                .map(role_id => `<@&${role_id}>`),
                        ),
                    )
                    .setFooter({
                        text: `ID: ${member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
        for (const id of roles_entry.roles) {
            if (this.do_not_restore.has(id) || id == this.wheatley.guild.roles.everyone.id) {
                continue;
            }
            const role = this.wheatley.guild.roles.cache.get(id);
            if (!role || !role.permissions.equals(this.wheatley.guild.roles.everyone.permissions) || role.managed) {
                continue;
            }
            await member.roles.add(role);
        }
    }
}
