import { strict as assert } from "assert";

import { Worker, isMainThread, parentPort } from "worker_threads";

import { RequestInfo, RequestInit, Response } from 'node-fetch';
import { parseHTML } from "linkedom";

const fetch = (url: RequestInfo, init?: RequestInit) =>
  import('node-fetch').then(({ default: fetch }) => fetch(url, init));

assert(parentPort);

const base_url = "https://man7.org/linux/man-pages/";

function extract_title(title: string) {
    assert(title.endsWith("— Linux manual page"));
    return title.substring(0, title.length - "— Linux manual page".length).trim();
}

function extract_h2(title: string | null) {
    assert(title);
    assert(title.endsWith(" top"), `title doesn't end with top: "${title}"`);
    return title.substring(0, title.length - " top".length).trim();
}

export type man7_entry = {
    title: string,
    path: string,
    name?: string,
    synopsis?: string,
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

export async function process_page(path: string) {
    let retry_count = 0;
    const max_retries = 8;
    let retry_delay = 1000;
    const retry_factor = 2;
    let response: Response | undefined;
    while(true) {
        let errored = false;
        try {
            response = await fetch(base_url + path);
        } catch(e) {
            errored = true;
        }
        if(!errored && response!.ok) {
            break;
        } else {
            if(++retry_count == max_retries) {
                throw Error("Fuck");
            } else {
                console.log("-----------------> Retrying", retry_count, path);
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
        title: extract_title(h1.innerHTML),
        path,
    };
    for(const h2 of h2s) {
        const h2_text = extract_h2(h2.textContent); // text_between(h2.innerHTML, "</a>", "<a href=");
        if(h2_text == "NAME") {
            //console.log(h2.nextElementSibling!.innerHTML.trim());
            data.name = process_field(h2.nextElementSibling!.textContent!.trim());
        } else if(h2_text == "SYNOPSIS") {
            //console.log(h2.nextElementSibling!.innerHTML.trim());
            data.synopsis = process_synopsis(h2.nextElementSibling!.textContent!);
        }
    }
    return data;
}

async function scrape(path: string): Promise<man7_entry> {
    console.log(path);
    return await process_page(path);
}

export type WorkerTask = {
    path: string;
};

export type WorkerMessage<TaskType> = {
    terminate: boolean;
    task?: TaskType;
};
export type WorkerResponse<ResultType> = {
    kick: boolean;
    result?: ResultType;
};

async function handle_worker_message(message: WorkerMessage<WorkerTask>): Promise<WorkerResponse<man7_entry>> {
    if(message.terminate) {
        process.exit();
    }
    assert(message.task);
    return {
        kick: false,
        result: await scrape(message.task?.path)
    };
}

parentPort.on("message", async (message: WorkerMessage<WorkerTask>) => {
    parentPort!.postMessage(await handle_worker_message(message));
});

parentPort.on("close", () => {
    process.exit();
});

parentPort!.postMessage({
    kick: true
});
