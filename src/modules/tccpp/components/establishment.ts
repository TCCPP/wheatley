import * as Discord from "discord.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import RoleManager from "../../../components/role-manager.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import SkillRoles from "./skill-roles.js";

export default class TheEstablishment extends BotComponent {
    // private established_role!: Discord.Role;

    override async setup(commands: CommandSetBuilder) {
        // const role_manager = unwrap(this.wheatley.components.get("RoleManager")) as RoleManager;
        // role_manager.register_role_check(this.check_established.bind(this));
        this.wheatley.is_established_member = this.is_established_member.bind(this);
    }

    private async is_established_member(
        options: Discord.GuildMember | Discord.User | Discord.UserResolvable | Discord.FetchMemberOptions,
    ) {
        const member = await this.wheatley.try_fetch_guild_member(options);
        if (!member) {
            return false;
        }
        return (
            SkillRoles.find_highest_skill_role_index(member.roles.cache) > 0 ||
            member.premiumSince != null ||
            member.permissions.has(Discord.PermissionFlagsBits.MuteMembers) ||
            member.permissions.has(Discord.PermissionFlagsBits.ModerateMembers)
        );
    }

    // private async check_established(member: Discord.GuildMember) {}
}
