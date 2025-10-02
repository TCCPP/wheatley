import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { unwrap } from "../utils/misc.js";
import { build_description } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
    CommandCategory,
} from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { BotTextBasedCommand } from "../command-abstractions/text-based-command-descriptor.js";

type CommandInfoWithAliases = {
    info: string;
    aliases: string[];
};

export default class Help extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private static readonly category_order: CommandCategory[] = [
        "References",
        "Wiki Articles",
        "Thread Control",
        "Utility",
        "Misc",
        "Moderation",
        "Moderation Utilities",
        "Admin utilities",
    ];

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("help", EarlyReplyMode.none)
                .set_category("Misc")
                .set_description("Bot help and info")
                .set_handler(this.help.bind(this)),
        );
    }

    private process_command_for_help(
        command: BotTextBasedCommand<unknown[]>,
        categories_map: Map<CommandCategory, CommandInfoWithAliases[]>,
        seen_command_groups: Set<string>,
        command_name_to_aliases: Map<string, string[]>,
        user_permissions: Discord.PermissionsBitField,
    ): void {
        if (command.alias_of) {
            return;
        }

        if (
            command.permissions !== undefined &&
            command.permissions !== 0n &&
            !user_permissions.has(command.permissions)
        ) {
            return;
        }

        const category = command.category ?? "Misc";
        if (category === "Hidden") {
            return;
        }

        const group_key = command.all_display_names.join(",");
        if (seen_command_groups.has(group_key)) {
            return;
        }
        seen_command_groups.add(group_key);

        if (!categories_map.has(category)) {
            categories_map.set(category, []);
        }

        const aliases = command_name_to_aliases.get(command.display_name) ?? [];
        unwrap(categories_map.get(category)).push({
            info: command.get_command_info(),
            aliases,
        });
    }

    private build_commands_map(
        user_permissions: Discord.PermissionsBitField,
    ): Map<CommandCategory, CommandInfoWithAliases[]> {
        const all_commands = this.wheatley.get_all_commands();
        const categories_map = new Map<CommandCategory, CommandInfoWithAliases[]>();
        const seen_command_groups = new Set<string>();
        const command_name_to_aliases = new Map<string, string[]>();

        // First pass: collect all aliases
        for (const command_descriptor of Object.values(all_commands)) {
            if (command_descriptor.alias_of) {
                if (!command_name_to_aliases.has(command_descriptor.alias_of)) {
                    command_name_to_aliases.set(command_descriptor.alias_of, []);
                }
                unwrap(command_name_to_aliases.get(command_descriptor.alias_of)).push(
                    `\`!${command_descriptor.display_name}\``,
                );
            }
        }

        // Second pass: build command map with aliases
        for (const command_descriptor of Object.values(all_commands)) {
            // If this command has subcommands, process them instead of the parent
            if (command_descriptor.subcommands) {
                for (const subcommand of command_descriptor.subcommands.values()) {
                    this.process_command_for_help(
                        subcommand,
                        categories_map,
                        seen_command_groups,
                        command_name_to_aliases,
                        user_permissions,
                    );
                }
                continue;
            }

            this.process_command_for_help(
                command_descriptor,
                categories_map,
                seen_command_groups,
                command_name_to_aliases,
                user_permissions,
            );
        }

        return categories_map;
    }

    private add_category_specific_content(category: CommandCategory, value_parts: string[]): void {
        if (category === "Wiki Articles") {
            value_parts.push("Article contributions are welcome [here](https://github.com/TCCPP/wiki)!");
        } else if (category === "Utility") {
            value_parts.unshift("`!f <reply>` Format the message being replied to");
        } else if (category === "Moderation") {
            value_parts.push(
                "Durations: `perm` for permanent or `number unit` (whitespace ignored). Units are y, M, w, d, h, m, s.",
            );
        }
    }

    private split_into_fields(
        category: CommandCategory,
        value_parts: string[],
        max_length: number = 1024,
    ): Discord.APIEmbedField[] {
        const fields: Discord.APIEmbedField[] = [];
        let current_parts: string[] = [];
        let current_length = 0;

        for (const part of value_parts) {
            const part_length = part.length + 1;
            if (current_length + part_length > max_length && current_parts.length > 0) {
                fields.push({
                    name: fields.length === 0 ? category : `${category} (cont.)`,
                    value: build_description(...current_parts),
                });
                current_parts = [];
                current_length = 0;
            }
            current_parts.push(part);
            current_length += part_length;
        }

        if (current_parts.length > 0) {
            fields.push({
                name: fields.length === 0 ? category : `${category} (cont.)`,
                value: build_description(...current_parts),
            });
        }

        return fields;
    }

    private build_category_fields(
        categories_map: Map<CommandCategory, CommandInfoWithAliases[]>,
    ): Discord.APIEmbedField[] {
        const fields: Discord.APIEmbedField[] = [];

        for (const category of Help.category_order) {
            if (categories_map.has(category)) {
                const commands = unwrap(categories_map.get(category));
                const value_parts: string[] = [];

                for (const command of commands) {
                    value_parts.push(command.info);
                    if (command.aliases.length > 0) {
                        value_parts.push(`- Shortcuts: ${command.aliases.join(", ")}`);
                    }
                }

                this.add_category_specific_content(category, value_parts);

                fields.push(...this.split_into_fields(category, value_parts));
            }
        }

        // TODO: Assert this doesn't happen...
        for (const [category, commands] of categories_map.entries()) {
            if (!Help.category_order.includes(category)) {
                const value_parts: string[] = [];
                for (const command of commands) {
                    value_parts.push(command.info);
                    if (command.aliases.length > 0) {
                        value_parts.push(`- Shortcuts: ${command.aliases.join(", ")}`);
                    }
                }
                fields.push(...this.split_into_fields(category, value_parts));
            }
        }

        return fields;
    }

    private build_help_embeds(fields: Discord.APIEmbedField[]): Discord.EmbedBuilder[] {
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle("Wheatley")
            .setDescription(
                build_description(
                    "Wheatley discord bot for the Together C & C++ server. The bot is open source, contributions " +
                        "are welcome at https://github.com/TCCPP/wheatley.",
                ),
            )
            .setThumbnail("https://avatars.githubusercontent.com/u/142943210")
            .addFields(...fields);

        return [embed];
    }

    async help(command: TextBasedCommand) {
        const member = await this.wheatley.guild.members.fetch(command.user.id);
        const user_permissions = member.permissions;

        const categories_map = this.build_commands_map(user_permissions);
        const fields = this.build_category_fields(categories_map);
        const embeds = this.build_help_embeds(fields);

        await command.reply({
            embeds,
            ephemeral_if_possible: true,
        });
    }
}
