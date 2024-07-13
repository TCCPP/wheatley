import * as Discord from "discord.js";

import { strict as assert } from "assert";

import * as fs from "fs";

import { format_list } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";

import { cppref_index, cppref_page, CpprefSubIndex } from "../../indexes/cppref/types.js";
import { Index } from "../algorithm/search.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

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
    for (const page of pages) {
        page_map[page.path] = page;
        if (page.title in title_map) {
            title_map[page.title].push(page);
        } else {
            title_map[page.title] = [page];
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const [title, pages] of Object.entries(title_map)) {
        if (pages.length > 1) {
            if (new Set(pages.map(e => e.wgPageName)).size == 1) {
                // all wgPageName match - these all alias
                pages.sort((a, b) => a.path.length - b.path.length);
                //console.log(title);
                //console.log(pages.map((e, i) => `    ${i == 0 ? "*" : " "} cppref/${e.path}`).join("\n"));
                for (const alias of pages.slice(1)) {
                    //console.log("        --> deleting", alias.path);
                    delete page_map[alias.path];
                }
            } else {
                pages.sort((a, b) => {
                    if (a.path.includes("/experimental/") && b.path.includes("/experimental/")) {
                        return 0;
                    } else if (a.path.includes("/experimental/")) {
                        return 1; // sort a after b
                    } else if (b.path.includes("/experimental/")) {
                        return -1; // sort b after a
                    } else {
                        return a.path.length - b.path.length;
                    }
                });
                //console.log(title);
                //console.log(pages.map((e, i) => `    ${i == 0 ? "*" : " "} cppref/${e.path}`).join("\n"));
                for (const to_delete of pages.slice(1)) {
                    //console.log("    --> deleting", to_delete.path);
                    delete page_map[to_delete.path];
                }
            }
        }
    }
    return Object.values(page_map);
}

export class CpprefIndex {
    c_index: Index<cppref_page>;
    cpp_index: Index<cppref_page>;

    setup_indexes(index_data: cppref_index) {
        this.c_index = new Index(eliminate_aliases_and_duplicates(index_data.c));
        this.cpp_index = new Index(eliminate_aliases_and_duplicates(index_data.cpp));
    }

    async load_data() {
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/cppref/cppref_index.json", { encoding: "utf-8" }),
        ) as cppref_index;
        this.setup_indexes(index_data);
    }

    // for testcase purposes
    load_data_sync() {
        const index_data = <cppref_index>(
            JSON.parse(fs.readFileSync("indexes/cppref/cppref_index.json", { encoding: "utf-8" }))
        );
        //for(const pages of [index.c, index.cpp]) {
        //    for(const page of pages) {
        //        if(DEBUG) console.log(page.title.split(",").map(x => x.trim()));
        //    }
        //}
        this.setup_indexes(index_data);
        return this;
    }

    lookup(query: string, target: CpprefSubIndex) {
        return (target == CpprefSubIndex.C ? this.c_index : this.cpp_index).search(query);
    }

    lookup_top_5(query: string, target: CpprefSubIndex) {
        return (target == CpprefSubIndex.C ? this.c_index : this.cpp_index).search_get_top_5(query);
    }
}

export default class Cppref extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    readonly index = new CpprefIndex();

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder(["cref", "cppref"])
                .set_description(["Query C reference pages", "Query C++ reference pages"])
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                    autocomplete: (query, name) =>
                        this.index
                            .lookup_top_5(query, name == "cref" ? CpprefSubIndex.C : CpprefSubIndex.CPP)
                            .map(page => ({
                                name: `${page.title.substring(0, 100 - 14)} . . . . ${
                                    Math.round(page.score * 100) / 100
                                }`,
                                value: page.title,
                            })),
                })
                .set_handler(this.cppref.bind(this)),
        );

        // Ok if the bot spins up while this is loading
        this.index.load_data().catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    async cppref(command: TextBasedCommand, query: string) {
        const result = this.index.lookup(query.trim(), command.name == "cref" ? CpprefSubIndex.C : CpprefSubIndex.CPP);
        M.log(`${command.name} query`, query, result ? `https://${result.path}` : null);

        if (result === null) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setAuthor({
                            name: "cppreference.com",
                            iconURL: "https://en.cppreference.com/favicon.ico",
                            url: "https://en.cppreference.com",
                        })
                        .setDescription("No results found"),
                ],
            });
        } else {
            // TODO: Clang format.....?
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setAuthor({
                    name: "cppreference.com",
                    iconURL: "https://en.cppreference.com/favicon.ico",
                    url: "https://en.cppreference.com",
                })
                .setTitle(result.title)
                .setURL(`https://${result.path}`);
            if (result.sample_declaration) {
                embed.setDescription(
                    `\`\`\`cpp\n${
                        result.sample_declaration +
                        (result.other_declarations ? `\n// ... and ${result.other_declarations} more` : "")
                    }\n\`\`\``,
                );
            }
            if (result.headers) {
                embed.addFields({
                    name: "Defined in",
                    value: format_list(result.headers.map(this.link_headers)),
                });
            }
            await command.reply({ embeds: [embed] });
        }
    }

    link_headers(header: string) {
        const matches = [...header.matchAll(/^<(.+)>$/g)];
        assert(matches.length == 1);
        const header_part = matches[0][1];
        if (header_part.endsWith(".h")) {
            return header;
        } else {
            return `[${header}](https://en.cppreference.com/w/cpp/header/${header_part}.html)`;
        }
    }
}
