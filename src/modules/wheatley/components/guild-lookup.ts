import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";

export default class GuildLookup extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("guild", EarlyReplyMode.none)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Guild tools")
                .add_subcommand(
                    new TextBasedCommandBuilder("lookup", EarlyReplyMode.none)
                        .set_category("Admin utilities")
                        .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                        .set_description("Guild lookup")
                        .add_string_option({
                            title: "id",
                            description: "The guild id",
                            required: true,
                        })
                        .set_handler(this.lookup.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("invite", EarlyReplyMode.none)
                        .set_category("Admin utilities")
                        .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                        .set_description("Guild invite")
                        .add_string_option({
                            title: "id",
                            description: "The guild id",
                            required: true,
                        })
                        .set_handler(this.invite.bind(this)),
                ),
        );
    }

    async lookup(command: TextBasedCommand, id: string) {
        const guild = await this.wheatley.client.guilds.fetch(id);
        await command.reply(`${guild.id} \`${guild.name}\``, true);
        await command.replyOrFollowUp(
            [...guild.channels.cache.values().map(channel => `${channel.id} ${channel.name}`)].join("\n"),
            true,
        );
    }

    async invite(command: TextBasedCommand, id: string) {
        const guild = await this.wheatley.client.guilds.fetch(id);
        const invite = await guild.invites.create(
            [...guild.channels.cache.values().filter(channel => channel.isTextBased())][0].id,
            {
                maxAge: 18000,
                maxUses: 1,
            },
        );
        await command.reply(invite.url, true);
    }
}
