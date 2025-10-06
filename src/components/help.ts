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

    private category_content_map = new Map<CommandCategory, string[]>();

    add_category_content(category: CommandCategory, content: string) {
        if (!this.category_content_map.has(category)) {
            this.category_content_map.set(category, []);
        }
        unwrap(this.category_content_map.get(category)).push(content);
    }

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

        // Sort aliases alphabetically
        for (const aliases of command_name_to_aliases.values()) {
            aliases.sort((a, b) => a.localeCompare(b));
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
        const content = this.category_content_map.get(category);
        if (content) {
            value_parts.push(...content);
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

        const all_categories = [
            ...Help.category_order,
            ...Array.from(categories_map.keys()).filter(cat => !Help.category_order.includes(cat)),
        ];

        for (const category of all_categories) {
            if (categories_map.has(category)) {
                const commands = unwrap(categories_map.get(category));
                commands.sort((a, b) => a.info.localeCompare(b.info));
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

        return fields;
    }

    private calculate_embed_size(embed: Discord.EmbedBuilder): number {
        let size = 0;
        const data = embed.data;
        if (data.title) {
            size += data.title.length;
        }
        if (data.description) {
            size += data.description.length;
        }
        if (data.footer?.text) {
            size += data.footer.text.length;
        }
        if (data.author?.name) {
            size += data.author.name.length;
        }
        if (data.fields) {
            for (const field of data.fields) {
                size += field.name.length + field.value.length;
            }
        }
        return size;
    }

    private build_help_embeds(fields: Discord.APIEmbedField[]): Discord.EmbedBuilder[] {
        const embeds: Discord.EmbedBuilder[] = [];
        const MAX_EMBED_SIZE = 5500;
        const MAX_FIELDS = 25;

        let current_embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle(this.wheatley.application.name ?? "Wheatley")
            .setDescription(
                (
                    (this.wheatley.application.description ?? "") +
                    (!this.wheatley.application.description?.includes("https://github.com/TCCPP/wheatley")
                        ? "\n\nBased on the open-source discord bot Wheatley. " +
                          "Contributions are welcome at https://github.com/TCCPP/wheatley."
                        : "")
                ).trim(),
            )
            .setThumbnail(this.wheatley.application.iconURL() ?? "https://avatars.githubusercontent.com/u/142943210");

        for (const field of fields) {
            const field_size = field.name.length + field.value.length;
            const current_size = this.calculate_embed_size(current_embed);
            const current_field_count = current_embed.data.fields?.length ?? 0;

            if (
                (current_size + field_size > MAX_EMBED_SIZE || current_field_count >= MAX_FIELDS) &&
                current_field_count > 0
            ) {
                embeds.push(current_embed);
                current_embed = new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle("Wheatley (continued)");
            }

            current_embed.addFields(field);
        }

        if ((current_embed.data.fields?.length ?? 0) > 0) {
            embeds.push(current_embed);
        }

        return embeds;
    }

    async help(command: TextBasedCommand) {
        const member = await this.wheatley.guild.members.fetch(command.user.id);
        const user_permissions = member.permissions;

        const categories_map = this.build_commands_map(user_permissions);
        const fields = this.build_category_fields(categories_map);
        const embeds = this.build_help_embeds(fields);

        for (let i = 0; i < embeds.length; i++) {
            await command.replyOrFollowUp({
                embeds: [embeds[i]],
                ephemeral_if_possible: true,
            });
        }
    }
}
