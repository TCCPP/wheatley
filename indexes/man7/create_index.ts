import { strict as assert } from "assert";

import * as fs from "fs";
import * as path from "path";

import { RequestInfo, RequestInit } from "node-fetch";
import { parseHTML } from "linkedom";

const fetch = (url: RequestInfo, init?: RequestInit) =>
    import("node-fetch").then(({ default: fetch }) => fetch(url, init));

import { ThreadPool } from "../common/utils";

import { man7_index, WorkerJob, WorkerResponse } from "./types";

const seed_url = "https://man7.org/linux/man-pages/dir_all_by_section.html";
const base_url = "https://man7.org/linux/man-pages/";

await (async () => {
    let man_entries: man7_index = [];
    if(fs.existsSync("man7_index.json")) {
        man_entries = JSON.parse(await fs.promises.readFile("man7_index.json", { encoding: "utf-8" }));
    }
    const milestones = new Set(man_entries.map(entry => entry.path));

    const response = await fetch(seed_url);
    assert(response.ok);
    const content = await response.text();
    const dom = parseHTML(content);
    const document = dom.window.document;

    // Interesting type assertion bug https://github.com/typescript-eslint/typescript-eslint/issues/2817
    const links = document.querySelectorAll<HTMLLinkElement>("pre a");
    const pool = new ThreadPool<WorkerJob, WorkerResponse>(path.resolve(__dirname, "worker.js"), 24);
    for(const link of links) {
        assert(link.href.startsWith("./"));
        const path = link.href.substring(2);
        if(!milestones.has(path)) {
            pool.submit_job({
                path,
                url: base_url + path
            });
        }
    }
    pool.drain();

    let missed_count = 0;
    for await(const result of pool) {
        if(result === null) { // can be null if the server returns 404
            missed_count++;
        } else {
            man_entries.push(result);
            if(man_entries.length % 1000 == 0) {
                // cache progress
                await fs.promises.writeFile("man7_index.json", JSON.stringify(man_entries, null, "    "));
            }
        }
    }

    console.log(man_entries.length, missed_count, links.length);
    assert(man_entries.length + missed_count == links.length);
    await fs.promises.writeFile("man7_index.json", JSON.stringify(man_entries, null, "    "));
})();
