import * as Discord from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

import { strict as assert } from "assert";

import * as fs from "fs";

import { critical_error, format_list, M } from "../utils";
import { is_authorized_admin } from "../common";
import { GuildCommandManager } from "../infra/guild_command_manager";

import { cppref_index, cppref_page, TargetIndex } from "../../indexes/cppref/types";
import { Index } from "../algorithm/search";


let client: Discord.Client;

let c_index: Index<cppref_page>;
let cpp_index: Index<cppref_page>;

const color = 0x7289DA; // todo: use ping color? make this common?

export function lookup(query: string, target: TargetIndex) {
    return (target == TargetIndex.C ? c_index : cpp_index).search(query);
}

function link_headers(header: string) {
    const matches = [...header.matchAll(/^<(.+)>$/g)];
    assert(matches.length == 1);
    const header_part = matches[0][1];
    if(header_part.endsWith(".h")) {
        return header;
    } else {
        return `[${header}](en.cppreference.com/w/cpp/header/${header_part}.html)`;
    }
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content.startsWith(".cref ") && is_authorized_admin(message.member!)) {
            const query = message.content.slice(".cref".length).trim();
        }
        if(message.content.startsWith(".cppref") && is_authorized_admin(message.member!)) {
            const query = message.content.slice(".cppref".length).trim();
            const result = lookup(query, TargetIndex.CPP);
            M.debug("cppref", [query, result]);
            if(result === null) {
                message.channel.send({embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(color)
                        .setAuthor({
                            name: "cppreference.com",
                            iconURL: "https://en.cppreference.com/favicon.ico",
                            url: "https://en.cppreference.com"
                        })
                        .setDescription("No results found")
                ]});
            } else {
                // TODO: Clang format.....?
                const embed = new Discord.EmbedBuilder()
                    .setColor(color)
                    .setAuthor({
                        name: "cppreference.com",
                        iconURL: "https://en.cppreference.com/favicon.ico",
                        url: "https://en.cppreference.com"
                    })
                    .setTitle(result.title)
                    .setURL(`https://${result.path}`);
                if(result.sample_declaration) {
                    embed.setDescription(`\`\`\`cpp\n${result.sample_declaration}\n\`\`\``);
                }
                if(result.headers) {
                    embed.addFields({
                        name: "Defined in",
                        value: format_list(result.headers.map(link_headers))
                    });
                }
                message.channel.send({embeds: [embed]});
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

/*async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && interaction.commandName == "echo") {
        assert(interaction.isChatInputCommand());
        const input = interaction.options.getString("input");
        M.debug("echo command", input);
        await interaction.reply({
            ephemeral: true,
            content: input || undefined
        });
    }
}*/

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        //client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

function eliminate_aliases_and_duplicates(pages: cppref_page[]) {
    // There's this annoying thing where multiple pages are really the same page
    // They're identical or nearly identical in html content and when you visit the .html directly they all redirect to
    // the same path.
    // For example:
    //   std::find, std::find_if, std::find_if_not
    //     cppref/en.cppreference.com/w/cpp/algorithm/find.html
    //     cppref/en.cppreference.com/w/cpp/algorithm/find_if.html
    //     cppref/en.cppreference.com/w/cpp/algorithm/find_if_not.html
    //   std::printf, std::fprintf, std::sprintf, std::snprintf
    //     cppref/en.cppreference.com/w/cpp/io/c/fprintf.html
    //     cppref/en.cppreference.com/w/cpp/io/c/printf.html
    //     cppref/en.cppreference.com/w/cpp/io/c/snprintf.html
    // These need to be eliminated as they all have the same title - this will cause problems for turning up multiple
    // very close search results.
    // There is another class of pages that have the same title, however these do actually have different content.
    // E.g.:
    //   std::move
    //     cppref/en.cppreference.com/w/cpp/algorithm/move.html
    //     cppref/en.cppreference.com/w/cpp/utility/move.html
    //   std::unexpected
    //     cppref/en.cppreference.com/w/cpp/error/unexpected.html
    //     cppref/en.cppreference.com/w/cpp/utility/expected/unexpected.html
    //   std::beta, std::betaf, std::betal
    //     cppref/en.cppreference.com/w/cpp/experimental/special_functions/beta.html
    //     cppref/en.cppreference.com/w/cpp/numeric/special_functions/beta.html
    //   std::owner_less
    //     cppref/en.cppreference.com/w/cpp/memory/owner_less.html
    //     cppref/en.cppreference.com/w/cpp/memory/owner_less_void.html
    //   strndup
    //     cppref/en.cppreference.com/w/c/experimental/dynamic/strndup.html
    //     cppref/en.cppreference.com/w/c/string/byte/strndup.html
    // There is a third class that's just a cppref error but I'm not going to correct the page (TODO)
    //   std::experimental::filesystem::directory_iterator::operator=
    //     cppref/en.cppreference.com/w/cpp/experimental/fs/directory_iterator/increment.html
    //     cppref/en.cppreference.com/w/cpp/experimental/fs/directory_iterator/operator=.html
    // std::move vs std::move is very hard to do anything about
    // similarly for std::owner_less it'd be nice to make the specialization std::owner_less<void> but that'd be
    //   something to change on cppref itself (TODO)
    // for strndup maybe it'd be good to include both, could revisit this later (TODO)
    // for std::unexpected it's probably best to take the one that's not removed
    // for "std::beta, std::betaf, std::betal" it's best to take the non-experimental one
    // currently we just take either the shorter path or the path that's not in experimental/
    // parsing out the since-until-deprecated-removed tags is a problem for another time
    // TODO: Could re-add the experimental tag....
    const page_map: Record<string, cppref_page> = {}; // map path to associated page object
    const title_map: Record<string, cppref_page[]> = {}; // map titles -> pages with that conflicting title
    for(const page of pages) {
        page_map[page.path] = page;
        if(page.title in title_map) {
            title_map[page.title].push(page);
        } else {
            title_map[page.title] = [page];
        }
    }
    // eslint-disable-next-line no-unused-vars
    for(const [title, pages] of Object.entries(title_map)) {
        if(pages.length > 1) {
            if(new Set(pages.map(e => e.wgPageName)).size == 1) {
                // all wgPageName match - these all alias
                pages.sort((a, b) => a.path.length - b.path.length);
                //console.log(title);
                //console.log(pages.map((e, i) => `    ${i == 0 ? "*" : " "} cppref/${e.path}`).join("\n"));
                for(const alias of pages.slice(1)) {
                    //console.log("        --> deleting", alias.path);
                    delete page_map[alias.path];
                }
            } else {
                pages.sort((a, b) => {
                    if(a.path.includes("/experimental/") && b.path.includes("/experimental/")) {
                        return 0;
                    } else if(a.path.includes("/experimental/")) {
                        return 1; // sort a after b
                    } else if(b.path.includes("/experimental/")) {
                        return -1; // sort b after a
                    } else {
                        return a.path.length - b.path.length;
                    }
                });
                //console.log(title);
                //console.log(pages.map((e, i) => `    ${i == 0 ? "*" : " "} cppref/${e.path}`).join("\n"));
                for(const to_delete of pages.slice(1)) {
                    //console.log("    --> deleting", to_delete.path);
                    delete page_map[to_delete.path];
                }
            }
        }
    }
    return Object.values(page_map);
}

function setup_indexes(index_data: cppref_index) {
    c_index = new Index(eliminate_aliases_and_duplicates(index_data.c));
    cpp_index = new Index(eliminate_aliases_and_duplicates(index_data.cpp));
}

export function cppref_testcase_setup() {
    const index_data = <cppref_index>(
        JSON.parse(fs.readFileSync("indexes/cppref/cppref_index.json", {encoding: "utf-8"}))
    );
    //for(const pages of [index.c, index.cpp]) {
    //    for(const page of pages) {
    //        if(DEBUG) console.log(page.title.split(",").map(x => x.trim()));
    //    }
    //}
    setup_indexes(index_data);
}

export async function setup_cppref(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    try {
        client = _client;
        /*const echo = new SlashCommandBuilder()
            .setName("echo")
            .setDescription("Echo")
            .addStringOption(option =>
                option.setName("input")
                    .setDescription("The input to echo back")
                    .setRequired(true));
        guild_command_manager.register(echo);*/
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/cppref/cppref_index.json", {encoding: "utf-8"})
        ) as cppref_index;
        setup_indexes(index_data);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
