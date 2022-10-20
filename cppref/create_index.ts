//import {JSDOM} from "jsdom";
import { parseHTML } from "linkedom";
import * as fs from "fs";
import * as path from "path";
import { strict as assert } from "assert";

import { cppref_index, cppref_page } from "./types";

import { tokenize } from "../src/components/cppref";

async function* walk_dir(dir: string): AsyncGenerator<string> {
    for(const f of await fs.promises.readdir(dir)) {
        const file_path = path.join(dir, f);
        if((await fs.promises.stat(file_path)).isDirectory()) {
            yield* walk_dir(file_path);
        } else {
            yield file_path;
        }
    }
}

let total_parse_time = 0;

const freq: Record<string, number> = {};

async function process_file(file: string) {
    if(file.endsWith(".html")) {
        const content = await fs.promises.readFile(file, {encoding: "utf-8"});
        const start = performance.now();
        //const dom = new JSDOM(content);
        const dom = parseHTML(content);
        const end = performance.now();
        total_parse_time += end - start;
        //const post0 = performance.now();
        const document = dom.window.document;
        const title_heading = document.getElementById("firstHeading");
        assert(title_heading);
        assert(title_heading.textContent);
        // cppref likes no-break spaces for some reason
        const title = title_heading.textContent.replace(/\u00a0/g, " ").trim();
        const entry: cppref_page = {
            title,
            path: file,
            headers: []
        };
        console.log(`    ${file}`);
        const decl_block = document.querySelector(".t-dcl-begin");
        if(decl_block) {
            const defined_in_header = decl_block.querySelectorAll(".t-dsc-header code");
            if(defined_in_header.length > 0) {
                entry.headers = [...defined_in_header].map(e => {
                    assert(e.textContent);
                    return e.textContent;
                });
            }
        }
        //const post1 = performance.now();
        //console.log(`        ${Math.round(post0 - start)}ms parse, ${Math.round(post1 - post0)}ms process`);

        const tokens = tokenize(title);
        for(const token of tokens) {
            if(!(token in freq) || typeof freq[token] != "number") { // deal with freq["constructor"]
                freq[token] = 0;
            }
            freq[token] += 1;
        }

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

    console.log(JSON.stringify(Object.entries(freq), null, "    "));

    for(const entry of Object.entries(freq).sort((a, b) => a[1] - b[1]).map(a => a.reverse())) {
        console.log(entry);
    }

    console.log(`${total_parse_time}ms`);
})();
