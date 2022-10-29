//import {JSDOM} from "jsdom";
import { parseHTML } from "linkedom";
import * as fs from "fs";
import * as path from "path";
import { strict as assert } from "assert";

import { cppref_index, cppref_page } from "./types";

async function* walk_dir(dir: string): AsyncGenerator<string> {
    for(const f of await fs.promises.readdir(dir)) {
        const file_path = path.join(dir, f).replace(/\\/g, "/");
        if((await fs.promises.stat(file_path)).isDirectory()) {
            yield* walk_dir(file_path);
        } else {
            yield file_path;
        }
    }
}

let total_read_time = 0;
let total_parse_time = 0;
let total_dom_time = 0; // getting elements, etc.
let total_search_time = 0; // text search for things like the wgPageName

async function process_file(file: string) {
    if(file.endsWith(".html")) {
        const read_start = performance.now();
        const content = await fs.promises.readFile(file, {encoding: "utf-8"});
        const read_end = performance.now();
        total_read_time += read_end - read_start;

        const parse_start = performance.now();
        //const dom = new JSDOM(content);
        const dom = parseHTML(content);
        const parse_end = performance.now();
        total_parse_time += parse_end - parse_start;

        const search_start = performance.now();
        //const wgPageNameMatches = [...content.matchAll(/"wgPageName":"(.+)","wgTitle/g)];
        //assert(wgPageNameMatches.length == 1);
        //const wgPageName = wgPageNameMatches[0][1];
        const wgPageName = content.substring(
            content.indexOf("\"wgPageName\":\"") + "\"wgPageName\":\"".length,
            content.indexOf("\",\"wgTitle")
        );
        const search_end = performance.now();
        total_search_time += search_end - search_start;

        const dom_start = performance.now();
        const document = dom.window.document;
        const title_heading = document.getElementById("firstHeading");
        assert(title_heading);
        assert(title_heading.textContent);
        // cppref likes no-break spaces for some reason
        const title = title_heading.textContent.replace(/\u00a0/g, " ").trim();
        let headers: string[] = [];
        const decl_block = document.querySelector(".t-dcl-begin");
        if(decl_block) {
            const defined_in_header = decl_block.querySelectorAll(".t-dsc-header code");
            if(defined_in_header.length > 0) {
                headers = [...defined_in_header].map(e => {
                    assert(e.textContent);
                    return e.textContent;
                });
            }
        }
        const dom_end = performance.now();
        total_dom_time += dom_end - dom_start;

        const entry: cppref_page = {
            title,
            path: file,
            wgPageName,
            headers
        };
        console.log(`    ${file}`);
        return entry;
    } else {
        //console.log(`Ignoring ${file_path}`);
    }
}

(async () => {
    const index: cppref_index = {
        c: [],
        cpp: []
    };

    console.log("en.cppreference.com/w/c");
    for await(const file of walk_dir("en.cppreference.com/w/c")) {
        assert(!(file in index.c));
        const entry = await process_file(file);
        if(entry) {
            index.c.push(entry);
        }
    }

    console.log("en.cppreference.com/w/cpp");
    for await(const file of walk_dir("en.cppreference.com/w/cpp")) {
        assert(!(file in index.cpp));
        const entry = await process_file(file);
        if(entry) {
            index.cpp.push(entry);
        }
    }

    await fs.promises.writeFile("cppref_index.json", JSON.stringify(index, null, "    "));

    console.log(`Read:   ${total_read_time}ms`);
    console.log(`Parse:  ${total_parse_time}ms`);
    console.log(`DOM:    ${total_dom_time}ms`);
    console.log(`Search: ${total_search_time}ms`);
})();
