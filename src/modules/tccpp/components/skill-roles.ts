import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { colors, HOUR, MINUTE } from "../../../common.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { Wheatley } from "../../../wheatley.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import RoleManager, { user_role_entry } from "../../../components/role-manager.js";

export const skill_role_ids = [
    "784733371275673600", // beginner
    "331876085820030978", // intermediate
    "849399021838925834", // proficient
    "331719590990184450", // advanced
    "331719591405551616", // expert
];

export default class SkillRoles extends BotComponent {
    private skill_role_log!: Discord.TextChannel;
    private skill_roles!: Discord.Role[];

    get roles() {
        return this.skill_roles;
    }

    database = unwrap(this.wheatley.database).create_proxy<{
        user_roles: user_role_entry & { last_known_skill_role: string | null };
    }>();

    override async setup(commands: CommandSetBuilder) {
        this.skill_role_log = await this.utilities.get_channel(this.wheatley.channels.skill_role_log);
        const role_manager = unwrap(this.wheatley.components.get("RoleManager")) as RoleManager;
        role_manager.register_role_check(this.check_skill_roles.bind(this));
        role_manager.register_role_update_listener(new Set(skill_role_ids), this.on_skill_role_change.bind(this));
    }

    override async on_ready(): Promise<void> {
        this.skill_roles = await Promise.all(
            skill_role_ids.map(async (id, index) => {
                const role = await this.wheatley.guild.roles.fetch(id);
                assert(role !== null, `Skill role ${id} not found`);
                return role;
            }),
        );
    }

    static find_highest_skill_role_index(roles: ReadonlySetLike<string>) {
        return skill_role_ids.findLastIndex(id => roles.has(id));
    }

    private async check_skill_roles(member: Discord.GuildMember) {
        const skill_roles = skill_role_ids.filter(id => member.roles.cache.has(id));
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
            ? skill_role_ids.indexOf(roles_entry.last_known_skill_role)
            : -1;
        const current_skill_level = SkillRoles.find_highest_skill_role_index(member.roles.cache);
        if (current_skill_level > last_known_skill_level) {
            M.log("Detected skill level increase for", member.user.tag);
            const current_skill_role = this.roles[current_skill_level];
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
