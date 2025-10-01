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
import Wiki from "./wiki.js";

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
            new TextBasedCommandBuilder("help", "Misc", EarlyReplyMode.none)
                .set_description("Bot help and info")
                .set_handler(this.help.bind(this)),
        );
    }

    private build_commands_map(user_permissions: Discord.PermissionsBitField): Map<CommandCategory, string[]> {
        const all_commands = this.wheatley.get_all_commands();
        const categories_map = new Map<CommandCategory, string[]>();

        for (const command_descriptor of Object.values(all_commands)) {
            if (command_descriptor.subcommands) {
                continue;
            }

            if (
                command_descriptor.permissions !== undefined &&
                command_descriptor.permissions !== 0n &&
                !user_permissions.has(command_descriptor.permissions)
            ) {
                continue;
            }

            const category = command_descriptor.category;
            if (!categories_map.has(category)) {
                categories_map.set(category, []);
            }
            unwrap(categories_map.get(category)).push(command_descriptor.get_command_info());
        }

        return categories_map;
    }

    private add_category_specific_content(category: CommandCategory, value_parts: string[]): void {
        if (category === "Wiki Articles") {
            const wiki_component = this.wheatley.components.get("Wiki");
            if (wiki_component) {
                value_parts.push(
                    "Article shortcuts: " +
                        (wiki_component as Wiki).article_aliases.map((_, alias) => `\`${alias}\``).join(", "),
                    "Article contributions are welcome [here](https://github.com/TCCPP/wiki)!",
                );
            }
        } else if (category === "Utility") {
            value_parts.unshift("`!f <reply>` Format the message being replied to");
        } else if (category === "Moderation") {
            const noofftopic_command = this.wheatley.get_command("noofftopic");
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (noofftopic_command) {
                value_parts.push(
                    "Rolepersist aliases: `noofftopic`, `nosuggestions`, `nosuggestionsatall`, " +
                        "`noreactions`, `nothreads`, `noseriousofftopic`, `notil`, `nomemes`. " +
                        `Syntax: \`${noofftopic_command.get_usage().replace("noofftopic", "(alias)")}\``,
                    "Durations: `perm` for permanent or `number unit` (whitespace ignored)." +
                        " Units are y, M, w, d, h, m, s.",
                );
            }
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

    private build_category_fields(categories_map: Map<CommandCategory, string[]>): Discord.APIEmbedField[] {
        const fields: Discord.APIEmbedField[] = [];

        for (const category of Help.category_order) {
            if (categories_map.has(category)) {
                const commands = unwrap(categories_map.get(category));
                const value_parts = [...commands];

                this.add_category_specific_content(category, value_parts);

                fields.push(...this.split_into_fields(category, value_parts));
            }
        }

        // TODO: Assert this doesn't happen...
        for (const [category, commands] of categories_map.entries()) {
            if (!Help.category_order.includes(category)) {
                fields.push(...this.split_into_fields(category, commands));
            }
        }

        return fields;
    }

    private build_help_embeds(fields: Discord.APIEmbedField[]): Discord.EmbedBuilder[] {
        const embeds: Discord.EmbedBuilder[] = [];
        const main_embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle("Wheatley")
            .setDescription(
                build_description(
                    "Wheatley discord bot for the Together C & C++ server. The bot is open source, contributions " +
                        "are welcome at https://github.com/TCCPP/wheatley.",
                ),
            )
            .setThumbnail("https://avatars.githubusercontent.com/u/142943210");

        const non_mod_fields = fields.filter(field => !field.name.toLowerCase().includes("moderation"));
        const mod_fields = fields.filter(field => field.name.toLowerCase().includes("moderation"));

        main_embed.addFields(...non_mod_fields);
        embeds.push(main_embed);

        if (mod_fields.length > 0) {
            embeds.push(new Discord.EmbedBuilder().setColor(colors.wheatley).addFields(...mod_fields));
        }

        return embeds;
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
