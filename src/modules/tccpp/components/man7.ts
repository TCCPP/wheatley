import * as Discord from "discord.js";

import { strict as assert } from "assert";

import * as fs from "fs";

import { M } from "../../../utils/debugging-and-logging.js";

import { Index, IndexEntry } from "../../../algorithm/search.js";
import { man7_entry, man7_index } from "../../../../indexes/man7/types.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { colors } from "../../../common.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";

type augmented_man7_entry = man7_entry & IndexEntry;

const SECTION_PRIORITY: Record<number, number> = { 3: 0.15, 2: 0.12, 1: 0.09, 7: 0.03 };

function extract_section_number(page_title: string): number {
    const match = page_title.match(/\((\d+)/);
    return match ? parseInt(match[1]) : 0;
}

function normalize_man7_title(title: string): string[] {
    const lower = title.toLowerCase();
    const match = lower.match(/^(.+?)\(\d+p?\)(.*)$/);
    if (match) {
        return [lower, match[1].trim()];
    }
    return [lower];
}

function base_function_name(title: string): string {
    const match = title.match(/^(.+?)\(/);
    return match ? match[1].trim().toLowerCase() : title.toLowerCase();
}

function eliminate_aliases_and_duplicates_and_set_title(index_data: man7_index) {
    const entry_map: Record<string, augmented_man7_entry> = {};
    const title_map: Record<string, augmented_man7_entry[]> = {};
    for (const entry of index_data) {
        assert(!(entry.path in entry_map));
        const section = extract_section_number(entry.page_title);
        const augmented_entry: augmented_man7_entry = {
            ...entry,
            title: entry.page_title + (entry.page_title.endsWith("p)") ? " (POSIX)" : ""),
            content: entry.short_description,
            boost: SECTION_PRIORITY[section] ?? 0,
        };
        entry_map[augmented_entry.path] = augmented_entry;
        if (augmented_entry.title in title_map) {
            title_map[augmented_entry.title].push(augmented_entry);
        } else {
            title_map[augmented_entry.title] = [augmented_entry];
        }
    }
    // Deduplicate pages with identical titles - prefer path matching the title's function name
    for (const cluster of Object.values(title_map)) {
        if (cluster.length > 1) {
            const name = base_function_name(cluster[0].title);
            cluster.sort((a, b) => {
                const a_matches = a.path.toLowerCase().includes(name);
                const b_matches = b.path.toLowerCase().includes(name);
                if (a_matches && !b_matches) {
                    return -1;
                } else if (!a_matches && b_matches) {
                    return 1;
                } else {
                    return a.path.length - b.path.length;
                }
            });
            for (const to_delete of cluster.slice(1)) {
                delete entry_map[to_delete.path];
            }
        }
    }
    // Remove POSIX pages when a non-POSIX page exists for the same function name
    const non_posix_names = new Set(
        Object.values(entry_map)
            .filter(e => !e.title.endsWith("(POSIX)"))
            .map(e => base_function_name(e.title)),
    );
    for (const entry of Object.values(entry_map)) {
        if (entry.title.endsWith("(POSIX)") && non_posix_names.has(base_function_name(entry.title))) {
            delete entry_map[entry.path];
        }
    }
    return Object.values(entry_map);
}

export class Man7Index {
    index!: Index<augmented_man7_entry>;

    setup_index(index_data: man7_index) {
        this.index = new Index(eliminate_aliases_and_duplicates_and_set_title(index_data), normalize_man7_title, {
            embedding_key_extractor: entry => entry.page_title,
            embedding_bonus: 0.15,
            downweight_patterns: [" (POSIX)"],
        });
    }

    async load_data() {
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/man7/man7_index.json", { encoding: "utf-8" }),
        ) as man7_index;
        this.setup_index(index_data);
        await this.index.load_embeddings("indexes/man7/embeddings.json");
    }

    // for testcase purposes
    load_data_sync() {
        const index_data = <man7_index>(
            JSON.parse(fs.readFileSync("indexes/man7/man7_index.json", { encoding: "utf-8" }))
        );
        this.setup_index(index_data);
        return this;
    }

    lookup(query: string) {
        return this.index.search(query);
    }

    async lookup_async(query: string) {
        return this.index.search_async(query);
    }

    lookup_top_5(query: string) {
        return this.index.search_get_top_5(query);
    }
}

export default class Man7 extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    index = new Man7Index();

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("man", EarlyReplyMode.none)
                .set_category("References")
                .set_description("Query linux man pages")
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                    autocomplete: query =>
                        this.index.lookup_top_5(query).map(page => ({
                            name: `${page.title.substring(0, 100 - 14)} . . . . ${Math.round(page.score * 100) / 100}`,
                            value: page.title,
                        })),
                })
                .set_handler(this.man.bind(this)),
        );

        // Ok if the bot spins up while this is loading
        this.index.load_data().catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    async man(command: TextBasedCommand, query: string) {
        const result = await this.index.lookup_async(query);
        M.log("man7 query", query, result ? `https://man7.org/linux/man-pages/${result.path}` : null);
        if (result === null) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setAuthor({
                            name: "man7",
                            url: "https://man7.org/linux/man-pages",
                        })
                        .setDescription("No results found"),
                ],
            });
        } else {
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setAuthor({
                    name: "man7",
                    url: "https://man7.org/linux/man-pages",
                })
                .setTitle(result.page_title)
                .setURL(`https://man7.org/linux/man-pages/${result.path}`)
                .setDescription(result.short_description ?? null);
            if (result.synopsis) {
                embed.addFields({
                    name: "Synopsis",
                    value: result.synopsis,
                });
            }
            await command.reply({ embeds: [embed] });
        }
    }
}
