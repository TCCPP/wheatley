import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../../../common.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { Wheatley } from "../../../wheatley.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import RoleManager, { user_role_entry } from "../../../components/role-manager.js";
import { capitalize } from "../../../utils/strings.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SkillLevel = {
    beginner: 0,
    intermediate: 1,
    proficient: 2,
    advanced: 3,
    expert: 4,
} as const;
export type skill_level = keyof typeof SkillLevel;

type skill_role_entry = { user_id: string; last_known_skill_role: string | null };

export default class SkillRoles extends BotComponent {
    private skill_role_log!: Discord.TextChannel;

    private skill_roles: Discord.Role[] = [];
    public readonly roles = {} as Record<skill_level, Discord.Role>;

    database = unwrap(this.wheatley.database).create_proxy<{
        user_roles: user_role_entry;
        skill_roles: skill_role_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        this.skill_role_log = await this.utilities.get_channel(this.wheatley.channels.skill_role_log);
    }

    override async on_ready() {
        for (const name in SkillLevel) {
            const role = this.wheatley.get_role_by_name(capitalize(name));
            this.skill_roles.push(role);
            this.roles[name as skill_level] = role;
        }
        await this.maybe_migrate_user_role_entries();
        const role_manager = unwrap(this.wheatley.components.get("RoleManager")) as RoleManager;
        role_manager.register_role_check(this.check_skill_roles.bind(this));
        role_manager.register_role_update_listener(
            new Set(this.skill_roles.map(r => r.id)),
            this.on_skill_role_change.bind(this),
        );
    }

    async maybe_migrate_user_role_entries() {
        const entries_to_migrate = await this.database.user_roles
            .find({ last_known_skill_role: { $exists: true } })
            .toArray();
        if (entries_to_migrate.length === 0) {
            return;
        }
        for (const entry of entries_to_migrate) {
            await this.database.skill_roles.updateOne(
                { user_id: entry.user_id },
                {
                    $set: {
                        user_id: entry.user_id,
                        last_known_skill_role: (entry as any).last_known_skill_role,
                    },
                },
                { upsert: true },
            );
            await this.database.user_roles.updateOne(
                { user_id: entry.user_id },
                { $unset: { last_known_skill_role: "" } },
            );
        }
        M.log(`Successfully migrated ${entries_to_migrate.length} skill role entries`);
    }

    find_highest_skill_level(member: Discord.GuildMember): number;
    find_highest_skill_level(roles: ReadonlySetLike<string>): number;
    find_highest_skill_level(options: ReadonlySetLike<string> | Discord.GuildMember) {
        if (options instanceof Discord.GuildMember) {
            return this.find_highest_skill_level(options.roles.cache);
        }
        return this.skill_roles.findLastIndex(r => options.has(r.id));
    }

    private async check_skill_roles(member: Discord.GuildMember) {
        const skill_roles = this.skill_roles.filter(r => member.roles.cache.has(r.id));
        if (skill_roles.length > 1) {
            M.log("removing redundant skill roles for", member.user.tag);
            for (const id of skill_roles.slice(0, -1)) {
                await member.roles.remove(id);
            }
        }
    }

    private async on_skill_role_change(member: Discord.GuildMember) {
        const roles_entry = await this.database.skill_roles.findOne({ user_id: member.id });
        const last_known_skill_level = roles_entry?.last_known_skill_role
            ? this.skill_roles.findIndex(r => r.id == roles_entry.last_known_skill_role)
            : -1;
        const current_skill_level = this.find_highest_skill_level(member);
        if (current_skill_level > SkillLevel.beginner && current_skill_level > last_known_skill_level) {
            M.log("Detected skill level increase for", member.user.tag);
            const current_skill_role = this.skill_roles[current_skill_level];
            assert(current_skill_role);
            await this.skill_role_log.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setAuthor({
                            name: member.displayName,
                            iconURL: member.displayAvatarURL(),
                        })
                        .setColor(current_skill_role.color)
                        .setDescription(
                            roles_entry?.last_known_skill_role
                                ? `<@&${roles_entry.last_known_skill_role}> -> <@&${current_skill_role.id}>`
                                : `<@&${current_skill_role.id}>`,
                        ),
                ],
            });
            // only update db state once role has been announced
            await this.database.skill_roles.findOneAndUpdate(
                { user_id: member.id },
                { $set: { last_known_skill_role: current_skill_role.id } },
                { upsert: true },
            );
        }
    }
}
