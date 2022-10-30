import { strict as assert } from "assert";

import * as EventEmitter from "events";

import { Worker } from "worker_threads";

type AsyncQueueResult<T> = {
    drained: boolean;
    value: T;
};

export class AsyncQueue<T> extends EventEmitter implements AsyncIterable<T> {
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
        // if drained is true we are done and the response will be junk
        return {
            done: response.drained,
            value: response.value
        };
    }
    [Symbol.asyncIterator]() {
        const q = this;
        return {
            async next(): Promise<IteratorResult<T>> {
                return q.get_next();
            }
        };
    }
}

export type MessageForWorker<JobType> = {
    terminate: boolean;
    job?: JobType;
};

export type MessageForThreadPool<ResultType> = {
    kick?: true;
    result?: ResultType;
};

export class ThreadPool<JobType, ResultType> implements AsyncIterable<ResultType> {
    threads: Worker[];
    jobs = new AsyncQueue<JobType>();
    results = new AsyncQueue<ResultType>();
    draining = false;
    active_workers = 0;
    constructor(worker_path: string, n_threads: number) {
        this.threads = new Array(n_threads).fill(0).map(() => this.create_new_worker(worker_path));
    }
    create_new_worker(worker_path: string) {
        const worker = new Worker(worker_path);
        worker.on("message", message => this.handle_worker_message(worker, message));
        return worker;
    }
    async handle_worker_message(worker: Worker, message: MessageForThreadPool<ResultType>) {
        if(message.kick) {
            this.active_workers++;
        } else {
            this.results.push(message.result!);
        }
        const {drained, value} = await this.jobs.get();
        if(drained) {
            worker.postMessage({
                terminate: true
            });
            if(--this.active_workers == 0) {
                this.results.drain();
            }
        } else {
            worker.postMessage({
                terminate: false,
                job: value
            });
        }
    }
    submit_job(job: JobType) {
        assert(!this.draining);
        this.jobs.push(job);
    }
    drain() {
        this.draining = false;
        this.jobs.drain();
    }
    [Symbol.asyncIterator]() {
        const q = this;
        return {
            async next(): Promise<IteratorResult<ResultType>> {
                return q.results.get_next();
            }
        };
    }
}
