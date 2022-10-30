import { strict as assert } from "assert";

import * as fs from "fs";
import * as path from "path";

import { cppref_index, TargetIndex, WorkerJob, WorkerResponse } from "./types";

import { ThreadPool } from "../common/utils";

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

(async () => {
    const index: cppref_index = {
        c: [],
        cpp: []
    };

    const pool = new ThreadPool<WorkerJob, WorkerResponse>(path.resolve(__dirname, "worker.js"), 12);

    const start = performance.now();

    let count = 0;

    (async () => {
        console.log("en.cppreference.com/w/c");
        for await(const path of walk_dir("en.cppreference.com/w/c")) {
            if(path.endsWith(".html")) {
                pool.submit_job({
                    path,
                    target_index: TargetIndex.C
                });
                count++;
            }
        }

        console.log("en.cppreference.com/w/cpp");
        for await(const path of walk_dir("en.cppreference.com/w/cpp")) {
            if(path.endsWith(".html")) {
                pool.submit_job({
                    path,
                    target_index: TargetIndex.CPP
                });
                count++;
            }
        }

        pool.drain();
    })();

    for await(const { target_index, entry } of pool) {
        (target_index == TargetIndex.C ? index.c : index.cpp).push(entry);
        count--;
    }

    assert(count == 0);

    index.c.sort((a, b) => a.path.localeCompare(b.path));
    index.cpp.sort((a, b) => a.path.localeCompare(b.path));

    const end = performance.now();

    console.log(`Wall clock time: ${end - start}ms`);

    await fs.promises.writeFile("cppref_index.json", JSON.stringify(index, null, "    "));
})();
