import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { HOUR } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley, WHEATLEY_ID } from "../wheatley.js";
import { set_interval } from "../utils/node.js";
import { equal } from "../utils/arrays.js";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

export default class RoleManager extends BotComponent {
    pink_role: Discord.Role;
    interval: NodeJS.Timeout | null = null;

    // current database state
    roles = new Map<string, string[]>();

    // roles that will not be re-applied on join
    blacklisted_roles: Set<string>;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        this.blacklisted_roles = new Set([
            this.wheatley.roles.root.id,
            this.wheatley.roles.moderators.id,
            this.wheatley.roles.featured_bot.id,
            this.wheatley.roles.official_bot.id,
            this.wheatley.roles.jedi_council.id,
            this.wheatley.roles.server_booster.id,
            this.wheatley.roles.pink.id,
            this.wheatley.roles.herald.id,
            this.wheatley.roles.linked_github.id,
            WHEATLEY_ID, // the everyone id
        ]);
        this.pink_role = unwrap(await this.wheatley.TCCPP.roles.fetch(this.wheatley.roles.pink.id));
        this.interval = set_interval(() => {
            this.check_members().catch(this.wheatley.critical_error.bind(this.wheatley));
        }, HOUR);
        this.startup_recovery().catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    async update_user_roles(member: Discord.GuildMember) {
        const old_roles = this.roles.get(member.id) ?? [];
        const current_roles = member.roles.cache.map(role => role.id);
        if (!equal(old_roles, current_roles)) {
            await this.wheatley.database.user_roles.updateOne(
                { user_id: member.id },
                {
                    $set: {
                        roles: current_roles,
                    },
                },
                { upsert: true },
            );
        }
    }

    async handle_pink(member: Discord.GuildMember) {
        if (member.roles.cache.some(role => role.id == this.wheatley.roles.pink.id)) {
            if (member.premiumSince == null) {
                M.log("removing pink for", member.user.tag);
                await member.roles.remove(this.pink_role);
            }
        }
    }

    async handle_skill_roles(member: Discord.GuildMember) {
        const skill_roles = member.roles.cache.filter(role =>
            Object.values(this.wheatley.skill_roles).some(skill_role => role.id == skill_role.id),
        );
        if (skill_roles.size > 1) {
            M.log("removing duplicate skill roles for", member.user.tag);
            skill_roles.sort((a, b) => b.rawPosition - a.rawPosition);
            M.debug(skill_roles.map(x => x.name));
            M.debug(skill_roles.map(x => x.name).slice(1));
            for (const role of skill_roles.map(x => x).slice(1)) {
                await member.roles.remove(role);
            }
        }
    }

    async check_member_roles(member: Discord.GuildMember) {
        await this.handle_pink(member);
        await this.handle_skill_roles(member);
        await this.update_user_roles(member);
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

    async startup_recovery() {
        const entries = await this.wheatley.database.user_roles.find().toArray();
        for (const entry of entries) {
            this.roles.set(entry.user_id, entry.roles);
        }
        await this.check_members();
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        await this.check_member_roles(new_member);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        // apply old roles
        const roles_entry = await this.wheatley.database.user_roles.findOne({ user_id: member.id });
        if (roles_entry === null) {
            return;
        }
        for (const role of roles_entry.roles) {
            if (!this.blacklisted_roles.has(role)) {
                await member.roles.add(role);
            }
        }
    }
}
