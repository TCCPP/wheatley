import { strict as assert } from "assert";

import { parentPort } from "worker_threads";
import * as fs from "fs";

import { parseHTML } from "linkedom";

import { cppref_page, WorkerJob, WorkerResponse } from "./types";
import { MessageForThreadPool, MessageForWorker } from "../common/utils";

assert(parentPort);

async function parse_file(path: string) {
    const content = await fs.promises.readFile(path, {encoding: "utf-8"});

    const dom = parseHTML(content);

    //const wgPageNameMatches = [...content.matchAll(/"wgPageName":"(.+)","wgTitle/g)];
    //assert(wgPageNameMatches.length == 1);
    //const wgPageName = wgPageNameMatches[0][1];
    const wgPageNameIndex = content.indexOf("\"wgPageName\":\"");
    const wgPageName = content.substring(
        wgPageNameIndex + "\"wgPageName\":\"".length,
        content.indexOf("\",\"wgTitle", wgPageNameIndex)
    );

    const document = dom.window.document;
    const title_heading = document.getElementById("firstHeading");
    assert(title_heading);
    assert(title_heading.textContent);
    // cppref likes no-break spaces for some reason
    const title = title_heading.textContent.replace(/\u00a0/g, " ").trim();
    let headers: string[] | undefined;
    let sample_declaration: string | undefined;
    let other_declarations: number | undefined;
    const decl_block = document.querySelector(".t-dcl-begin");
    if(decl_block) {
        const defined_in_header = decl_block.querySelectorAll(".t-dsc-header code");
        if(defined_in_header.length > 0) {
            headers = [...defined_in_header].map(e => {
                assert(e.textContent);
                return e.textContent;
            });
        }
        /*const decl_row = decl_block.querySelector(".t-dcl td");
        if(decl_row) {
            sample_declaration = decl_row.textContent!.trim();
        }*/
        const decl_rows = [...decl_block.querySelectorAll(".t-dcl")];
        if(decl_rows.length > 0) {
            // just take the first
            sample_declaration = decl_rows[0].querySelector("td")!.textContent!.trim();
            if(decl_rows.length > 1) {
                other_declarations = decl_rows.length - 1;
            }
        }
    }

    const entry: cppref_page = {
        title,
        path,
        wgPageName,
        headers,
        sample_declaration,
        other_declarations
    };
    console.log(`    ${path}`);
    return entry;
}

async function handle_worker_message(message: MessageForWorker<WorkerJob>):
    Promise<MessageForThreadPool<WorkerResponse>> {
    if(message.terminate) {
        process.exit();
    }
    assert(message.job);
    return {
        result: {
            entry: await parse_file(message.job.path),
            target_index: message.job.target_index
        }
    };
}

parentPort.on("message", async (message: MessageForWorker<WorkerJob>) => {
    parentPort!.postMessage(await handle_worker_message(message));
});

parentPort.on("close", () => {
    process.exit();
});

parentPort!.postMessage({
    kick: true
});
