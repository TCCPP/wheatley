import * as Discord from "discord.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { role_map } from "../../../role-map.js";
import { wheatley_roles } from "../../wheatley/roles.js";
import RoleManager from "../../wheatley/components/role-manager.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";

export default class Pink extends BotComponent {
    private roles = role_map(this.wheatley, wheatley_roles.pink);

    override async setup(commands: CommandSetBuilder) {
        this.roles.resolve();
        const role_manager = unwrap(this.wheatley.components.get("RoleManager")) as RoleManager;
        role_manager.register_role_check(this.check_pink.bind(this));

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
                .set_description("Drops pink")
                .set_slash(false)
                .set_handler(this.unpink.bind(this)),
        );
    }

    async gibpink(command: TextBasedCommand) {
        const member = await command.get_member(this.wheatley.guild);
        if (member.premiumSince == null) {
            await command.reply("Nice try.", true, true);
            return;
        }
        if (member.roles.cache.some(r => r.id == this.roles.pink.id)) {
            await command.reply("You are currently pink", true, true);
            return;
        }
        await member.roles.add(this.roles.pink);
        await command.reply("You are now pink", true, true);
    }

    async unpink(command: TextBasedCommand) {
        const member = await command.get_member(this.wheatley.guild);
        if (!member.roles.cache.some(r => r.id == this.roles.pink.id)) {
            await command.reply("You are not currently pink", true, true);
            return;
        }
        await member.roles.remove(this.roles.pink);
    }

    async check_pink(member: Discord.GuildMember) {
        if (member.roles.cache.has(this.roles.pink.id)) {
            if (member.premiumSince == null) {
                M.log("removing pink for", member.user.tag);
                await member.roles.remove(this.roles.pink);
            }
        }
    }
}
