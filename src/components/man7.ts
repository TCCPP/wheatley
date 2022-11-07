import * as Discord from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import { strict as assert } from "assert";

import * as fs from "fs";

import { critical_error, M } from "../utils";

import { Index, IndexEntry } from "../algorithm/search";
import { man7_entry, man7_index } from "../../indexes/man7/types";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { colors } from "../common";

type augmented_man7_entry = man7_entry & IndexEntry

function eliminate_aliases_and_duplicates_and_set_title(index_data: man7_index) {
    const entry_map: Record<string, augmented_man7_entry> = {}; // map path to associated entry
    const title_map: Record<string, augmented_man7_entry[]> = {}; // map titles -> pages with that conflicting title
    for(const entry of index_data) {
        assert(!(entry.path in entry_map));
        const augmented_entry = {
            ...entry,
            title: entry.page_title + (entry.page_title.endsWith("p)") ? " (POSIX)" : "")
        };
        entry_map[augmented_entry.path] = augmented_entry;
        if(augmented_entry.title in title_map) {
            title_map[augmented_entry.title].push(augmented_entry);
        } else {
            title_map[augmented_entry.title] = [augmented_entry];
        }
    }
    for(const cluster of Object.values(title_map)) {
        if(cluster.length > 1) {
            cluster.sort((a, b) => a.path.length - b.path.length);
            //console.log(cluster[0].title);
            //console.log(cluster.map((e, i) => `    ${i == 0 ? "*" : " "} ${e.path}`).join("\n"));
            for(const to_delete of cluster.slice(1)) {
                //console.log("    --> deleting", to_delete.path);
                delete entry_map[to_delete.path];
            }
        }
    }
    return Object.values(entry_map);
}

export class Man7Index {
    index: Index<augmented_man7_entry>;

    setup_index(index_data: man7_index) {
        // TODO: Prioritize (3), then (2), then (1), then other?
        this.index = new Index(
            eliminate_aliases_and_duplicates_and_set_title(index_data),
            (title: string) => [title.toLowerCase()]
        );
    }

    async load_data() {
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/man7/man7_index.json", { encoding: "utf-8" })
        ) as man7_index;
        this.setup_index(index_data);
    }

    // for testcase purposes
    load_data_sync() {
        const index_data = <man7_index>(
            JSON.parse(fs.readFileSync("indexes/man7/man7_index.json", { encoding: "utf-8" }))
        );
        //for(const pages of [index.c, index.cpp]) {
        //    for(const page of pages) {
        //        if(DEBUG) console.log(page.title.split(",").map(x => x.trim()));
        //    }
        //}
        this.setup_index(index_data);
        return this;
    }

    lookup(query: string) {
        return this.index.search(query);
    }

    lookup_top_5(query: string) {
        return this.index.search_get_top_5(query);
    }
}

export class Man7 extends BotComponent {
    index = new Man7Index();

    constructor(wheatley: Wheatley) {
        super(wheatley);

        const man7 = new SlashCommandBuilder()
            .setName("man")
            .setDescription("Query linux man pages")
            .addStringOption(option =>
                option.setName("query")
                    .setDescription("Query")
                    .setAutocomplete(true)
                    .setRequired(true));
        this.wheatley.guild_command_manager.register(man7);
        // Ok if the bot spins up while this is loading
        this.index.load_data();
    }

    override async on_message_create(message: Discord.Message) {
        try {
            if(message.author.bot) return; // Ignore bots
            if(message.content.startsWith("!man ")) {
                const query = message.content.slice("!man".length).trim();
                const result = this.index.lookup(query);
                M.log("man7 query", query, result ? `https://man7.org/linux/man-pages/${result.path}` : null);
                if(result === null) {
                    const result_message = await message.channel.send({ embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(colors.color)
                            .setAuthor({
                                name: "man7",
                                url: "https://man7.org/linux/man-pages"
                            })
                            .setDescription("No results found")
                    ] });
                    this.wheatley.deletable.make_message_deletable(message, result_message);
                } else {
                    const embed = new Discord.EmbedBuilder()
                        .setColor(colors.color)
                        .setAuthor({
                            name: "man7",
                            url: "https://man7.org/linux/man-pages"
                        })
                        .setTitle(result.page_title)
                        .setURL(`https://man7.org/linux/man-pages/${result.path}`)
                        .setDescription(result.short_description ?? null);
                    if(result.synopsis) {
                        embed.addFields({
                            name: "Synopsis",
                            value: result.synopsis
                        });
                    }
                    const result_message = await message.channel.send({ embeds: [embed] });
                    this.wheatley.deletable.make_message_deletable(message, result_message);
                }
            }
        } catch(e) {
            critical_error(e);
        }
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if(interaction.isCommand() && interaction.commandName == "man") {
            assert(interaction.isChatInputCommand());
            const query = interaction.options.getString("query")!.trim();
            const result = this.index.lookup(query);
            M.log("man7 query", query,
                  result ? `https://man7.org/linux/man-pages/${result.path}` : null);
            if(result === null) {
                await interaction.reply({ embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.color)
                        .setAuthor({
                            name: "man7",
                            url: "https://man7.org/linux/man-pages"
                        })
                        .setDescription("No results found")
                ] });
            } else {
                const embed = new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setAuthor({
                        name: "man7",
                        url: "https://man7.org/linux/man-pages"
                    })
                    .setTitle(result.page_title)
                    .setURL(`https://man7.org/linux/man-pages/${result.path}`)
                    .setDescription(result.short_description ?? null);
                if(result.synopsis) {
                    embed.addFields({
                        name: "Synopsis",
                        value: result.synopsis
                    });
                }
                await interaction.reply({ embeds: [embed] });
            }
        } else if(interaction.isAutocomplete() && interaction.commandName == "man") {
            const query = interaction.options.getFocused().trim();
            await interaction.respond(
                this.index.lookup_top_5(query)
                    .map(page => ({
                        name: `${page.title.substring(0, 100 - 14)} . . . . ${Math.round(page.score * 100) / 100}`,
                        value: page.title
                    }))
            );
        }
    }
}
