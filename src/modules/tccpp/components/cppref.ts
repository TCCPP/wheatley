import * as Discord from "discord.js";

import { strict as assert } from "assert";

import * as fs from "fs";

import { format_list } from "../../../utils/strings.js";
import { M } from "../../../utils/debugging-and-logging.js";

import { cppref_index, cppref_page, CpprefSubIndex } from "../../../../indexes/cppref/types.js";
import { Index, IndexEntry } from "../../../algorithm/search.js";
import { normalize_and_split_cppref_title } from "../cppref-normalizer.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { colors } from "../../../common.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";

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

type augmented_cppref_page = cppref_page & IndexEntry;

function extract_path_alias(path: string): string | null {
    const match = path.match(/\/([^/]+?)\.html?$/);
    if (!match) {
        return null;
    }
    const name = match[1];
    if (/^[a-z_][a-z0-9_]*$/i.test(name)) {
        return name.toLowerCase();
    }
    return null;
}

const PATH_ALIAS_SKIP_DIRECTORIES = /\/(keyword|experimental|header|locale|symbol_index)\//;
const ELIGIBLE_PATH_DEPTH = /\/w\/c(?:pp)?\/[^/]+\/[^/]+\.html?$/;
// Only add path aliases for pages directly under a top-level category (e.g., algorithm/transform.html)
// excluding keyword, experimental, and header directories. This gives pages like language/enum.html an
// alias "enum" so they outrank keyword/enum.html (-2.0 penalty) and types/is_enum.html (alias "is_enum").
function is_eligible_for_path_alias(path: string): boolean {
    return !PATH_ALIAS_SKIP_DIRECTORIES.test(path) && ELIGIBLE_PATH_DEPTH.test(path);
}

function build_directory_file_map(pages: cppref_page[]): Map<string, string[]> {
    const dir_files = new Map<string, string[]>();
    for (const page of pages) {
        const last_slash = page.path.lastIndexOf("/");
        const dir = page.path.substring(0, last_slash);
        const file = page.path.substring(last_slash + 1);
        if (!dir_files.has(dir)) {
            dir_files.set(dir, []);
        }
        dir_files.get(dir)!.push(file);
    }
    return dir_files;
}

// Skip alias when a sibling file starts with the same name followed by a non-identifier character
// (e.g., sizeof.html has sibling sizeof....html - the "..." variant is a distinct concept)
function has_confusable_sibling(alias: string, path: string, dir_files: Map<string, string[]>): boolean {
    const last_slash = path.lastIndexOf("/");
    const dir = path.substring(0, last_slash);
    const file = path.substring(last_slash + 1);
    const siblings = dir_files.get(dir) ?? [];
    return siblings.some(
        f => f !== file && f.startsWith(alias) && f.length > alias.length && !/[a-z0-9_]/i.test(f[alias.length]),
    );
}

function compute_path_alias(path: string, dir_files: Map<string, string[]>): string | null {
    if (!is_eligible_for_path_alias(path)) {
        return null;
    }
    const alias = extract_path_alias(path);
    if (!alias) {
        return null;
    }
    if (has_confusable_sibling(alias, path, dir_files)) {
        return null;
    }
    return alias;
}

function augment_cppref_pages(pages: cppref_page[]): augmented_cppref_page[] {
    const dir_files = build_directory_file_map(pages);
    return pages.map(page => {
        const is_keyword_page = page.path.includes("/keyword/");
        const alias = compute_path_alias(page.path, dir_files);
        return {
            ...page,
            content: [page.wgPageName.replace(/\//g, " "), ...(page.headers ?? [])].join(" "),
            ...(alias ? { aliases: [alias] } : {}),
            ...(is_keyword_page ? { boost: -2.0 } : {}),
        };
    });
}

export class CpprefIndex {
    c_index!: Index<augmented_cppref_page>;
    cpp_index!: Index<augmented_cppref_page>;

    setup_indexes(index_data: cppref_index) {
        this.c_index = new Index(
            augment_cppref_pages(eliminate_aliases_and_duplicates(index_data.c)),
            normalize_and_split_cppref_title,
            {
                embedding_key_extractor: entry => `c/${entry.wgPageName}`,
                embedding_bonus: 0.15,
                downweight_patterns: [" keywords:"],
            },
        );
        this.cpp_index = new Index(
            augment_cppref_pages(eliminate_aliases_and_duplicates(index_data.cpp)),
            normalize_and_split_cppref_title,
            {
                embedding_key_extractor: entry => `cpp/${entry.wgPageName}`,
                embedding_bonus: 0.15,
                downweight_patterns: [" keywords:"],
            },
        );
    }

    async load_data() {
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/cppref/cppref_index.json", { encoding: "utf-8" }),
        ) as cppref_index;
        this.setup_indexes(index_data);
        await Promise.all([
            this.c_index.load_embeddings("indexes/cppref/embeddings.json"),
            this.cpp_index.load_embeddings("indexes/cppref/embeddings.json"),
        ]);
    }

    // for testcase purposes
    load_data_sync() {
        const index_data = <cppref_index>(
            JSON.parse(fs.readFileSync("indexes/cppref/cppref_index.json", { encoding: "utf-8" }))
        );
        this.setup_indexes(index_data);
        return this;
    }

    lookup(query: string, target: CpprefSubIndex) {
        return (target == CpprefSubIndex.C ? this.c_index : this.cpp_index).search(query);
    }

    async lookup_async(query: string, target: CpprefSubIndex) {
        return (target == CpprefSubIndex.C ? this.c_index : this.cpp_index).search_async(query);
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

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder(["cref", "cppref"], EarlyReplyMode.none)
                .set_category("References")
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
        const result = await this.index.lookup_async(
            query.trim(),
            command.name == "cref" ? CpprefSubIndex.C : CpprefSubIndex.CPP,
        );
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
                    value: format_list(result.headers.map(Cppref.link_headers)),
                });
            }
            await command.reply({ embeds: [embed] });
        }
    }

    static link_headers(header: string) {
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
