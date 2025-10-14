import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../../../common.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { Wheatley } from "../../../wheatley.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import RoleManager, { user_role_entry } from "../../../components/role-manager.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SkillLevel = {
    Beginner: 0,
    Intermediate: 1,
    Proficient: 2,
    Advanced: 3,
    Expert: 4,
} as const;
export type skill_level = keyof typeof SkillLevel;

export default class SkillRoles extends BotComponent {
    private skill_role_log!: Discord.TextChannel;
    private skill_roles: Discord.Role[] = [];

    public readonly roles: {
        [k in skill_level]: Discord.Role;
    } = {} as any;

    database = unwrap(this.wheatley.database).create_proxy<{
        user_roles: user_role_entry & { last_known_skill_role: string | null };
    }>();

    override async setup(commands: CommandSetBuilder) {
        this.skill_role_log = await this.utilities.get_channel(this.wheatley.channels.skill_role_log);
    }

    override async on_ready() {
        for (const name in SkillLevel) {
            const role = this.wheatley.get_role_by_name(name);
            this.skill_roles.push(role);
            this.roles[name as skill_level] = role;
        }
        const role_manager = unwrap(this.wheatley.components.get("RoleManager")) as RoleManager;
        role_manager.register_role_check(this.check_skill_roles.bind(this));
        role_manager.register_role_update_listener(
            new Set(this.skill_roles.map(r => r.id)),
            this.on_skill_role_change.bind(this),
        );
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
        const roles_entry = await this.database.user_roles.findOne({ user_id: member.id });
        const last_known_skill_level = roles_entry?.last_known_skill_role
            ? this.skill_roles.findIndex(r => r.id == roles_entry.last_known_skill_role)
            : -1;
        const current_skill_level = this.find_highest_skill_level(member);
        if (current_skill_level > last_known_skill_level) {
            M.log("Detected skill level increase for", member.user.tag);
            const current_skill_role = this.skill_roles[current_skill_level];
            assert(current_skill_role);
            if (current_skill_level > 0) {
                // don't announce self-assigned roles
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
            }
            // only update db state once role has been announced
            await this.database.user_roles.findOneAndUpdate(
                { user_id: member.id },
                { $set: { last_known_skill_role: current_skill_role.id } },
                { upsert: true },
            );
        }
    }
}
