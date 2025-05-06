import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { set_interval } from "../utils/node.js";
import { build_description } from "../utils/strings.js";

export type user_role_entry = {
    user_id: string;
    roles: string[];
};

type role_check = (member: Discord.GuildMember) => Promise<void>;
type role_change_listener = (role_id: string, member: Discord.GuildMember) => Promise<void>;

export default class RoleManager extends BotComponent {
    private interval: NodeJS.Timeout | null = null;

    // current database state
    private roles = new Map<string, Set<string>>();

    // roles that will not be re-applied on join
    private blacklisted_roles: Set<string>;

    private role_checks: role_check[] = [];
    private on_role_changed = new Map<string, role_change_listener[]>();

    private database = unwrap(this.wheatley.database).create_proxy<{
        user_roles: user_role_entry;
    }>();

    override async on_ready() {
        for await (const entry of this.database.user_roles.find()) {
            this.roles.set(entry.user_id, new Set(entry.roles));
        }

        this.blacklisted_roles = new Set([
            // general
            this.wheatley.roles.root.id,
            this.wheatley.roles.moderators.id,
            this.wheatley.TCCPP.id, // the everyone id
            // moderation roles
            this.wheatley.roles.muted.id,
            this.wheatley.roles.monke.id,
            this.wheatley.roles.no_off_topic.id,
            this.wheatley.roles.no_suggestions.id,
            this.wheatley.roles.no_suggestions_at_all.id,
            this.wheatley.roles.no_reactions.id,
            this.wheatley.roles.no_images.id,
            this.wheatley.roles.no_threads.id,
            this.wheatley.roles.no_serious_off_topic.id,
            this.wheatley.roles.no_til.id,
            this.wheatley.roles.no_memes.id,
            // other misc roles
            this.wheatley.roles.featured_bot.id,
            this.wheatley.roles.official_bot.id,
            this.wheatley.roles.jedi_council.id,
            this.wheatley.roles.server_booster.id,
            this.wheatley.roles.pink.id,
            this.wheatley.roles.herald.id,
            this.wheatley.roles.linked_github.id,
        ]);

        const check = () => {
            this.check_members().catch(this.wheatley.critical_error.bind(this.wheatley));
        };
        check();
        this.interval = set_interval(check, HOUR);
    }

    register_role_check(check: role_check) {
        this.role_checks.push(check);
    }

    register_role_update_listener(role_id: string, listener: role_change_listener) {
        if (!this.on_role_changed.has(role_id)) {
            this.on_role_changed.set(role_id, []);
        }
        unwrap(this.on_role_changed.get(role_id)).push(listener);
    }

    async check_member_roles(member: Discord.GuildMember) {
        for (const check of this.role_checks) {
            await check(member);
        }
        const old_roles = this.roles.get(member.id);
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
            this.roles.set(member.id, new_roles);
            const events = (diff ?? new_roles).intersection(this.on_role_changed);
            for (const id of events) {
                const listeners = this.on_role_changed.get(id);
                if (listeners) {
                    for (const listener of listeners) {
                        await listener(id, member);
                    }
                }
            }
        }
    }

    async check_members() {
        M.log("Starting role checks");
        try {
            const members = await this.wheatley.TCCPP.members.fetch();
            for (const member of members.values()) {
                await this.check_member_roles(member);
            }
        } catch (e) {
            this.wheatley.critical_error(e);
        }
        M.log("Finished role checks");
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        await this.check_member_roles(new_member);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        // apply old roles
        const roles_entry = await this.database.user_roles.findOne({ user_id: member.id });
        if (roles_entry === null) {
            return;
        }
        this.wheatley.llog(this.wheatley.channels.staff_member_log, {
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
                                .filter(role_id => role_id != this.wheatley.TCCPP.id)
                                .map(role_id => `<@&${role_id}>`),
                        ),
                    )
                    .setFooter({
                        text: `ID: ${member.user.id}`,
                    })
                    .setTimestamp(Date.now()),
            ],
        });
        for (const role of roles_entry.roles) {
            if (!this.blacklisted_roles.has(role)) {
                await member.roles.add(role);
            }
        }
    }
}
