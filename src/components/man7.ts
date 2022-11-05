import * as Discord from "discord.js";
import { SlashCommandBuilder } from "discord.js";

import { strict as assert } from "assert";

import * as fs from "fs";

import { critical_error, M } from "../utils";

import { Index, IndexEntry } from "../algorithm/search";
import { man7_entry, man7_index } from "../../indexes/man7/types";
import { make_message_deletable } from "./deletable";
import { GuildCommandManager } from "../infra/guild_command_manager";

let client: Discord.Client;

type augmented_man7_entry = man7_entry & IndexEntry

let index: Index<augmented_man7_entry>;

const color = 0x7289DA; // todo: use ping color? make this common?

export enum TargetIndex { C, CPP }

export function lookup(query: string) {
    return index.search(query);
}

function lookup_top_5(query: string) {
    return index.search_get_top_5(query);
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content.startsWith("!man ")) {
            const query = message.content.slice("!man".length).trim();
            const result = lookup(query);
            M.log("man7 query", query, result ? `https://man7.org/linux/man-pages/${result.path}` : null);
            if(result === null) {
                const result_message = await message.channel.send({embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(color)
                        .setAuthor({
                            name: "man7",
                            url: "https://man7.org/linux/man-pages"
                        })
                        .setDescription("No results found")
                ]});
                make_message_deletable(message, result_message);
            } else {
                const embed = new Discord.EmbedBuilder()
                    .setColor(color)
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
                const result_message = await message.channel.send({embeds: [embed]});
                make_message_deletable(message, result_message);
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && interaction.commandName == "man") {
        assert(interaction.isChatInputCommand());
        const query = interaction.options.getString("query")!.trim();
        const result = lookup(query);
        M.log("man7 query", query,
              result ? `https://man7.org/linux/man-pages/${result.path}` : null);
        if(result === null) {
            await interaction.reply({embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color)
                    .setAuthor({
                        name: "man7",
                        url: "https://man7.org/linux/man-pages"
                    })
                    .setDescription("No results found")
            ]});
        } else {
            const embed = new Discord.EmbedBuilder()
                .setColor(color)
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
            await interaction.reply({embeds: [embed]});
        }
    } else if(interaction.isAutocomplete() && interaction.commandName == "man") {
        const query = interaction.options.getFocused().trim();
        await interaction.respond(
            lookup_top_5(query)
                .map(page => ({
                    name: `${page.title.substring(0, 100 - 14)} . . . . ${Math.round(page.score * 100) / 100}`,
                    value: page.title
                }))
        );
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

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

function setup_index(index_data: man7_index) {
    // TODO: Prioritize (3), then (2), then (1), then other?
    index = new Index(
        eliminate_aliases_and_duplicates_and_set_title(index_data),
        (title: string) => [title.toLowerCase()]
    );
}

export function man7_testcase_setup() {
    const index_data = <man7_index>(
        JSON.parse(fs.readFileSync("indexes/man7/man7_index.json", {encoding: "utf-8"}))
    );
    //for(const pages of [index.c, index.cpp]) {
    //    for(const page of pages) {
    //        if(DEBUG) console.log(page.title.split(",").map(x => x.trim()));
    //    }
    //}
    setup_index(index_data);
}

export async function setup_man7(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    // TODO: Come back and implement the slash command
    try {
        client = _client;
        const man7 = new SlashCommandBuilder()
            .setName("man")
            .setDescription("Query linux man pages")
            .addStringOption(option =>
                option.setName("query")
                    .setDescription("Query")
                    .setAutocomplete(true)
                    .setRequired(true));
        guild_command_manager.register(man7);
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/man7/man7_index.json", {encoding: "utf-8"})
        ) as man7_index;
        setup_index(index_data);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
