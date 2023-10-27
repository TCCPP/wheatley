import * as Discord from "discord.js";

import * as fs from "fs";

import { critical_error } from "../utils/debugging-and-logging.js";
import { M } from "../utils/debugging-and-logging.js";

import { Index, IndexEntry } from "../algorithm/search.js";
import { core_guidelines_entry, core_guidelines_index } from "../../indexes/core_guidelines/types.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

type augmented_core_guidelines_entry = core_guidelines_entry & IndexEntry;

export class CoreGuidelinesIndex {
    index: Index<augmented_core_guidelines_entry>;

    setup_index(index_data: core_guidelines_index) {
        this.index = new Index(index_data, (title: string) => [
            title.toLowerCase(),
        ]);
    }

    async load_data() {
        const index_data = JSON.parse(
            await fs.promises.readFile("indexes/core_guidelines/core_guidelines_index.json", { encoding: "utf-8" }),
        ) as core_guidelines_index;
        this.setup_index(index_data);
    }

    // for testcase purposes
    load_data_sync() {
        const index_data = <core_guidelines_index>(
            JSON.parse(fs.readFileSync("indexes/core_guidelines/core_guidelines_index.json", { encoding: "utf-8" }))
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

/**
 * Adds the /guide command for searching cpp core guidelines.
 */
export default class CoreGuidelines extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    index = new CoreGuidelinesIndex();

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("guide")
                .set_description("Query C++ Core Guidelines")
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
                .set_handler(this.guide.bind(this)),
        );

        // Ok if the bot spins up while this is loading
        this.index.load_data().catch(critical_error);
    }

    async guide(command: TextBasedCommand, query: string) {
        const result = this.index.lookup(query);
        M.log("core guidelines query", query, result ? `https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines${result.anchor}` : null);
        if (result === null) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setAuthor({
                            name: "C++ Core Guidelines",
                            iconURL: "https://isocpp.github.io/CppCoreGuidelines/cpp_core_guidelines_16b.png",
                            url: "https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines",
                        })
                        .setDescription("No results found"),
                ],
            });
        } else {
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setAuthor({
                    name: "C++ Core Guidelines",
                    iconURL: "https://isocpp.github.io/CppCoreGuidelines/cpp_core_guidelines_16b.png",
                    url: "https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines",
                })
                .setTitle(result.id + ": " + result.caption)
                .setURL(`https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines${result.anchor}`)
            await command.reply({ embeds: [embed] });
        }
    }
}
