import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { skill_roles_order, skill_roles_order_id, Wheatley } from "../wheatley.js";
import { set_interval } from "../utils/node.js";
import { build_description } from "../utils/strings.js";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

type user_role_entry = {
    user_id: string;
    roles: string[];
    last_known_skill_role: string | null;
};

type role_check = (member: Discord.GuildMember) => Promise<void>;
type role_change_listener = (role_id: string, member: Discord.GuildMember) => Promise<void>;

export default class RoleManager extends BotComponent {
    private skill_role_log!: Discord.TextChannel;
    private staff_member_log!: Discord.TextChannel;
    pink_role!: Discord.Role;
    interval: NodeJS.Timeout | null = null;

    // current database state
    private roles = new Map<string, Set<string>>();

    // roles that will not be re-applied on join
    blacklisted_roles!: Set<string>;

    private database = this.wheatley.database.create_proxy<{
        user_roles: user_role_entry;
    }>();

    private role_checks: role_check[] = [];
    private on_role_changed = new Map<string, role_change_listener[]>();

    register_role_check(check: role_check) {
        this.role_checks.push(check);
    }

    register_role_update_listener(role_id: string, listener: role_change_listener) {
        if (!this.on_role_changed.has(role_id)) {
            this.on_role_changed.set(role_id, []);
        }
        unwrap(this.on_role_changed.get(role_id)).push(listener);
    }

    override async setup(commands: CommandSetBuilder) {
        this.skill_role_log = await this.utilities.get_channel(this.wheatley.channels.skill_role_log);
        this.staff_member_log = await this.utilities.get_channel(this.wheatley.channels.staff_member_log);

        commands.add(
            new TextBasedCommandBuilder("gimmepink", EarlyReplyMode.ephemeral)
                .set_category("Misc")
                .set_description("Gives pink")
                .set_slash(false)
                .set_handler(this.gibpink.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("unpink", EarlyReplyMode.ephemeral)
                .set_category("Misc")
                .set_description("Takes pink")
                .set_slash(false)
                .set_handler(this.unpink.bind(this)),
        );
    }

    override async on_ready() {
        for await (const entry of this.database.user_roles.find()) {
            this.roles.set(entry.user_id, new Set(entry.roles));
        }

        this.blacklisted_roles = new Set([
            // general
            this.wheatley.roles.root.id,
            this.wheatley.roles.moderators.id,
            this.wheatley.guild.id, // the everyone id
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
        this.pink_role = unwrap(await this.wheatley.guild.roles.fetch(this.wheatley.roles.pink.id));

        this.register_role_check(this.check_pink.bind(this));
        this.register_role_check(this.check_skill_roles.bind(this));
        for (const id of skill_roles_order_id) {
            this.register_role_update_listener(id, this.check_for_skill_role_bump.bind(this));
        }

        const check = () => {
            this.check_members().catch(this.wheatley.critical_error.bind(this.wheatley));
        };
        check();
        this.interval = set_interval(check, HOUR);
    }

    get_highest_skill_role(roles: string[]) {
        return skill_roles_order_id.filter(id => roles.includes(id)).at(-1) ?? null;
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
            const skill_role = this.get_highest_skill_role(member.roles.cache.map(role => role.id));
            await this.database.user_roles.findOneAndUpdate(
                { user_id: member.id },
                { $set: skill_role ? { roles: role_ids } : { roles: role_ids, last_known_skill_role: skill_role } },
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

    async gibpink(command: TextBasedCommand) {
        const member = await command.get_member(this.wheatley.guild);
        if (member.premiumSince == null) {
            await command.reply("Nice try.", true, true);
            return;
        }
        if (member.roles.cache.some(r => r.id == this.pink_role.id)) {
            await command.reply("You are currently pink", true, true);
            return;
        }
        await member.roles.add(this.pink_role);
        await command.reply("You are now pink", true, true);
    }

    async unpink(command: TextBasedCommand) {
        const member = await command.get_member(this.wheatley.guild);
        if (!member.roles.cache.some(r => r.id == this.pink_role.id)) {
            await command.reply("You are not currently pink", true, true);
            return;
        }
        await member.roles.remove(this.pink_role);
    }

    async check_pink(member: Discord.GuildMember) {
        if (member.roles.cache.some(role => role.id == this.wheatley.roles.pink.id)) {
            if (member.premiumSince == null) {
                M.log("removing pink for", member.user.tag);
                await member.roles.remove(this.pink_role);
            }
        }
    }

    async check_skill_roles(member: Discord.GuildMember) {
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

    async check_for_skill_role_bump(role_id: string, member: Discord.GuildMember) {
        const roles_entry = await this.database.user_roles.findOne({ user_id: member.id });
        const last_known_skill_level =
            roles_entry && roles_entry.last_known_skill_role
                ? this.wheatley.get_skill_role_index(roles_entry.last_known_skill_role)
                : -1;
        const current_skill_role = this.get_highest_skill_role(member.roles.cache.map(role => role.id));
        const current_skill_level = current_skill_role ? this.wheatley.get_skill_role_index(current_skill_role) : -1;
        if (
            current_skill_level > skill_roles_order.indexOf("beginner") &&
            current_skill_level > last_known_skill_level
        ) {
            assert(current_skill_role);
            M.log("Detected skill level increase for", member.user.tag);
            await this.skill_role_log.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setAuthor({
                            name: member.displayName,
                            iconURL: member.displayAvatarURL(),
                        })
                        .setColor(unwrap(await this.wheatley.guild.roles.fetch(current_skill_role)).color)
                        .setDescription(
                            roles_entry?.last_known_skill_role
                                ? `<@&${roles_entry.last_known_skill_role}> -> <@&${current_skill_role}>`
                                : `<@&${current_skill_role}>`,
                        ),
                ],
            });
        }
    }

    async check_members() {
        M.log("Starting role checks");
        try {
            const members = await this.wheatley.guild.members.fetch();
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
        this.wheatley.llog(this.staff_member_log, {
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
        for (const role of roles_entry.roles) {
            if (!this.blacklisted_roles.has(role)) {
                await member.roles.add(role);
            }
        }
    }
}
