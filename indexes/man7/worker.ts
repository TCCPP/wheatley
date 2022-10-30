import { strict as assert } from "assert";

import { parentPort } from "worker_threads";

import { RequestInfo, RequestInit, Response } from 'node-fetch';
import { parseHTML } from "linkedom";
import { man7_entry, WorkerJob, WorkerResponse } from "./types";
import { MessageForThreadPool, MessageForWorker } from "../common/utils";

const fetch = (url: RequestInfo, init?: RequestInit) =>
  import('node-fetch').then(({ default: fetch }) => fetch(url, init));

assert(parentPort);

function extract_title(title: string) {
    assert(title.endsWith("— Linux manual page"));
    return title.substring(0, title.length - "— Linux manual page".length).trim();
}

function extract_h2(title: string | null) {
    assert(title);
    // there is one page on the entire site that doesn't have a top link in the h2....
    // https://man7.org/linux/man-pages/man5/groff_font.5.html
    //assert(title.endsWith(" top"), `title doesn't end with top: "${title}"`);
    if(title.endsWith(" top")) {
        return title.substring(0, title.length - " top".length).trim();
    } else {
        return title.trim();
    }
}

async function wait(ms: number) {
    return new Promise<void>(resolve => setTimeout(() => {
        resolve();
    }, ms));
}

// normalize whitspace
function process_field(text: string) {
    return text.replace(/\s{2,}/, " ").trim();
}

function process_synopsis(text: string) {
    return text.split("\n").map(line => line.replace(/^ {7}/, "")).filter(line => line.trim().length != 0).join("\n");
}

async function fulfill_job(job: WorkerJob): Promise<man7_entry | null> {
    console.log(job.url);
    let retry_count = 0;
    const max_retries = 8;
    let retry_delay = 1000;
    const retry_factor = 2;
    let response: Response | undefined;
    while(true) {
        let errored = false;
        try {
            response = await fetch(job.url);
        } catch(e) {
            errored = true;
        }
        if(!errored && response!.ok) {
            break;
        } else if(response && response.status == 404) {
            console.log("404 while trying to access", job.url);
            return null;
        } else {
            if(++retry_count == max_retries) {
                throw Error("Failed to get page, exceeded max retries");
            } else {
                console.log("-----------------> Retrying", retry_count, job.path);
                await wait(retry_delay);
                retry_delay *= retry_factor;
            }
        }
    }
    const content = await response!.text();
    const dom = parseHTML(content);
    const document = dom.window.document;
    const h1 = document.querySelector("h1");
    assert(h1);
    const h2s = document.querySelectorAll("h2");
    const data: man7_entry = {
        title: extract_title(h1.textContent!),
        path: job.path,
    };
    for(const h2 of h2s) {
        const h2_text = extract_h2(h2.textContent);
        if(h2_text == "NAME") {
            data.name = process_field(h2.nextElementSibling!.textContent!.trim());
        } else if(h2_text == "SYNOPSIS") {
            data.synopsis = process_synopsis(h2.nextElementSibling!.textContent!);
        }
    }
    return data;
}

async function handle_worker_message(message: MessageForWorker<WorkerJob>):
    Promise<MessageForThreadPool<WorkerResponse>> {
    if(message.terminate) {
        process.exit();
    }
    assert(message.job);
    return {
        result: await fulfill_job(message.job)
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
