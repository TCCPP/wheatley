import { strict as assert } from "assert";

import * as fs from "fs";
import * as path from "path";

import { cppref_index, CpprefSubIndex, WorkerJob, WorkerResponse } from "./types";

import { Funnel, ThreadPool } from "../common/utils";

import { clang_format_embed_code } from "../../src/components/format";

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

await (async () => {
    let index: cppref_index = {
        c: [],
        cpp: []
    };

    if(fs.existsSync("cppref_index.json")) {
        index = JSON.parse(await fs.promises.readFile("cppref_index.json", { encoding: "utf-8" }));
    }

    const handled_paths = new Set([ ...index.c, ...index.cpp ].map(page => page.path));

    const pool = new ThreadPool<WorkerJob, WorkerResponse>(path.resolve(__dirname, "worker.js"), 12);

    const parse_start = performance.now();

    let count = 0;

    await (async () => {
        console.log("en.cppreference.com/w/c");
        for await(const path of walk_dir("en.cppreference.com/w/c")) {
            if(path.endsWith(".html")) {
                if(!handled_paths.has(path)) {
                    pool.submit_job({
                        path,
                        target_index: CpprefSubIndex.C
                    });
                }
                count++;
            }
        }

        console.log("en.cppreference.com/w/cpp");
        for await(const path of walk_dir("en.cppreference.com/w/cpp")) {
            if(path.endsWith(".html")) {
                if(!handled_paths.has(path)) {
                    pool.submit_job({
                        path,
                        target_index: CpprefSubIndex.CPP
                    });
                }
                count++;
            }
        }

        pool.drain();
    })();

    for await(const { target_index, entry } of pool) {
        (target_index == CpprefSubIndex.C ? index.c : index.cpp).push(entry);
    }

    const parse_end = performance.now();

    console.log(index.c.length + index.cpp.length, count);
    assert(index.c.length + index.cpp.length == count);

    index.c.sort((a, b) => a.path.localeCompare(b.path));
    index.cpp.sort((a, b) => a.path.localeCompare(b.path));

    const format_start = performance.now();

    const funnel = new Funnel(8);
    for(const sub_index of [ index.c, index.cpp ]) {
        for(const page of sub_index) {
            if(page.sample_declaration && !handled_paths.has(page.path)) {
                const page_ref_copy = page;
                funnel.submit(async () => {
                    page.sample_declaration = await clang_format_embed_code(
                        page_ref_copy.sample_declaration!.replace(/\s+/g, " ")
                    );
                });
            }
        }
    }
    await funnel.wait_all();

    const format_end = performance.now();

    console.log(`Parse wall clock time:  ${parse_end - parse_start}ms`);
    console.log(`Format wall clock time: ${format_end - format_start}ms`);

    await fs.promises.writeFile("cppref_index.json", JSON.stringify(index, null, "    "), { encoding: "utf-8" });
})();
