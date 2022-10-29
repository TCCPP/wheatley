import { strict as assert } from "assert";

import * as fs from "fs";
import * as path from "path";

import { RequestInfo, RequestInit } from 'node-fetch';
import { parseHTML } from "linkedom";

const fetch = (url: RequestInfo, init?: RequestInit) =>
  import('node-fetch').then(({ default: fetch }) => fetch(url, init));

import { Worker, isMainThread, parentPort } from "worker_threads";
import * as EventEmitter from "events";

type AsyncQueueResult<T> = {
    drained: boolean;
    value: T;
};

class AsyncQueue<T> extends EventEmitter implements AsyncIterable<AsyncQueueResult<T>> {
    data: T[] = [];
    draining = false;
    constructor() {
        super();
    }
    push(item: T) {
        assert(!this.draining);
        this.data.push(item);
        this.emit("push");
    }
    drain() {
        this.draining = true;
        this.emit("drain");
    }
    async get(): Promise<AsyncQueueResult<T>> {
        if(this.data.length > 0) {
            return {
                drained: false,
                value: this.data.shift()!
            };
        } else if(this.draining) {
            return {
                drained: true,
                value: undefined as any
            };
        } else {
            return new Promise(resolve => {
                const closure = () => {
                    this.removeListener("push", closure);
                    this.removeListener("drain", closure);
                    if(this.data.length > 0) {
                        resolve({
                            drained: false,
                            value: this.data.shift()!
                        });
                    } else {
                        assert(this.draining);
                        resolve({
                            drained: true,
                            value: undefined as any
                        });
                    }
                };
                this.on("push", closure);
                this.on("drain", closure);
            })
        }
    }
    async get_next() {
        const response = await this.get();
        // if draining is true we are done
        // if draining is false we are done if the internal queue is empty and we're draining
        return {
            done: response.drained,
            value: response
        };
    }
    [Symbol.asyncIterator]() {
        const q = this;
        return {
            async next(): Promise<IteratorResult<AsyncQueueResult<T>>> {
                return q.get_next();
            }
        };
    }
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

class ThreadPool<TaskType, ResultType> implements AsyncIterable<AsyncQueueResult<ResultType>> {
    threads: Worker[];
    tasks = new AsyncQueue<TaskType>();
    results = new AsyncQueue<ResultType>();
    draining = false;
    active_workers = 0;
    constructor(worker_path: string, n_threads: number) {
        this.threads = new Array(n_threads).fill(0).map(() => this.create_new_worker(worker_path));
    }
    create_new_worker(worker_path: string) {
        const worker = new Worker(path.resolve(__dirname, worker_path));
        worker.on("message", message => this.handle_worker_message(worker, message));
        return worker;
    }
    async handle_worker_message(worker: Worker, message: WorkerResponse<ResultType>) {
        if(message.result) {
            //console.log("--> got", (message.result as any as man7_entry).path);
            this.results.push(message.result);
        } else {
            assert(message.kick);
            this.active_workers++;
            //console.log(this.active_workers);
        }
        const {drained, value} = await this.tasks.get();
        if(drained) {
            worker.postMessage({
                terminate: true
            });
            //console.log(this.active_workers - 1);
            if(--this.active_workers == 0) {
                this.results.drain();
            }
        } else {
            worker.postMessage({
                terminate: false,
                task: value
            });
        }
    }
    submit_task(task: TaskType) {
        assert(!this.draining);
        this.tasks.push(task);
    }
    drain() {
        this.draining = false;
        this.tasks.drain();
    }
    [Symbol.asyncIterator]() {
        const q = this;
        return {
            async next(): Promise<IteratorResult<AsyncQueueResult<ResultType>>> {
                return q.results.get_next();
            }
        };
    }
}



const seed_url = "https://man7.org/linux/man-pages/dir_all_by_section.html";
const base_url = "https://man7.org/linux/man-pages/";

/*function text_between(str: string, left: string, right: string) {
    assert(str.indexOf(left) > -1);
    assert(str.lastIndexOf(right) > -1);
    assert(str.indexOf(left) < str.lastIndexOf(right));
    return str.substring(
        str.indexOf(left) + left.length,
        str.lastIndexOf(right)
    ).replace(/&nbsp;/g, " ").trim();
}*/

export type man7_entry = {
    title: string,
    path: string,
    name?: string,
    synopsis?: string,
}

(async () => {
    /*{
        const queue = new AsyncQueue<number>();
        let counter = 0;

        (async () => {
            const interval = setInterval(() => {
                queue.push(++counter);
                if(counter == 10) {
                    clearInterval(interval);
                    queue.drain();
                }
            }, 1000);

            for await(const {drained: drain, value} of queue) {
                if(drain) {
                    break;
                }
                console.log(value);
            }
            console.log("xxx");
        })();
    }
    return;*/
    let man_entries: man7_entry[] = [];
    if(fs.existsSync("man7_index.json")) {
        man_entries = JSON.parse(await fs.promises.readFile("man7_index.json", {encoding: "utf-8"}));
    }
    const milestones = new Set(man_entries.map(entry => entry.path));

    const response = await fetch(seed_url);
    assert(response.status == 200);
    const content = await response.text();
    const dom = parseHTML(content);
    //console.log(content);
    const document = dom.window.document;
    const links = document.querySelectorAll("pre a") as NodeListOf<HTMLLinkElement>;
    const pool = new ThreadPool<{path: string}, man7_entry>("worker.js", 1);
    for(const link of links) {
        /*console.log(link.href);
        const entry = await process_page(link.href);
        //console.log(entry);
        assert(!(entry.title in man_entries));
        man_entries.push(entry);
        //break;*/
        assert(link.href.startsWith("./"));
        const path = link.href.substring(2)
        if(!milestones.has(path)) {
            pool.submit_task({path});
        }
    }
    pool.drain();
    //console.log([...links].map(e => e.href))
    //console.log(man_entries);
    for await(const {drained, value} of pool) {
        if(drained) {
            break;
        }
        //console.log(x);
        //console.log("----> xxx", value.path);
        man_entries.push(value);
        if(man_entries.length % 1000 == 0) {
            // cache progress
            await fs.promises.writeFile("man7_index.json", JSON.stringify(man_entries, null, "    "));
        }
    }
    console.log(man_entries.length, links.length);
    assert(man_entries.length == links.length);
    await fs.promises.writeFile("man7_index.json", JSON.stringify(man_entries, null, "    "));
})();
