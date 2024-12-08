import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { skill_roles_order, skill_roles_order_id, Wheatley } from "../wheatley.js";
import { set_interval } from "../utils/node.js";
import { equal } from "../utils/arrays.js";
import { build_description } from "../utils/strings.js";
import { SelfClearingSet } from "../utils/containers.js";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

export default class RoleManager extends BotComponent {
    pink_role: Discord.Role;
    interval: NodeJS.Timeout | null = null;

    // current database state
    roles = new Map<string, string[]>();

    // stores user id + role id encoded as a user_id,role_id string
    debounce_map = new SelfClearingSet(MINUTE);

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
            this.wheatley.TCCPP.id, // the everyone id
        ]);
        this.pink_role = unwrap(await this.wheatley.TCCPP.roles.fetch(this.wheatley.roles.pink.id));
        this.interval = set_interval(() => {
            this.check_members().catch(this.wheatley.critical_error.bind(this.wheatley));
        }, HOUR);
        this.startup_recovery().catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    get_highest_skill_role(roles: string[]) {
        return skill_roles_order_id.filter(id => roles.includes(id)).at(-1) ?? null;
    }

    async update_user_roles(member: Discord.GuildMember) {
        const old_roles = this.roles.get(member.id) ?? [];
        const current_roles = member.roles.cache.map(role => role.id);
        if (!equal(old_roles, current_roles)) {
            const skill_role = this.get_highest_skill_role(current_roles);
            await this.wheatley.database.user_roles.updateOne(
                { user_id: member.id },
                {
                    $set: skill_role
                        ? {
                              roles: current_roles,
                              last_known_skill_role: this.get_highest_skill_role(current_roles),
                          }
                        : {
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

    async check_for_skill_role_bump(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        const roles_entry = await this.wheatley.database.user_roles.findOne({ user_id: new_member.id });
        const last_known_skill_level =
            roles_entry && roles_entry.last_known_skill_role
                ? this.wheatley.get_skill_role_index(roles_entry.last_known_skill_role)
                : -1;
        const current_skill_role = this.get_highest_skill_role(new_member.roles.cache.map(role => role.id));
        const current_skill_level = current_skill_role ? this.wheatley.get_skill_role_index(current_skill_role) : -1;
        if (
            current_skill_level > skill_roles_order.indexOf("beginner") &&
            current_skill_level > last_known_skill_level
        ) {
            assert(current_skill_role);
            const debounce_key = `${new_member.id},${current_skill_role}`;
            // Updates are bumpy...
            if (this.debounce_map.has(debounce_key)) {
                return;
            }
            this.debounce_map.insert(debounce_key);
            M.log("Detected skill level increase for", new_member.user.tag);
            await this.wheatley.channels.skill_role_log.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setAuthor({
                            name: new_member.displayName,
                            iconURL: new_member.displayAvatarURL(),
                        })
                        .setColor(unwrap(await this.wheatley.TCCPP.roles.fetch(current_skill_role)).color)
                        .setDescription(
                            roles_entry?.last_known_skill_role
                                ? `<@&${roles_entry.last_known_skill_role}> -> <@&${current_skill_role}>`
                                : `<@&${current_skill_role}>`,
                        ),
                ],
            });
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
        await this.check_for_skill_role_bump(old_member, new_member);
        await this.check_member_roles(new_member);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        // apply old roles
        const roles_entry = await this.wheatley.database.user_roles.findOne({ user_id: member.id });
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
