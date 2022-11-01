import { strict as assert } from "assert";

import * as EventEmitter from "events";

import { Worker } from "worker_threads";

type AsyncQueueResult<T> = {
    drained: boolean;
    value: T;
};

export class AsyncQueue<T> implements AsyncIterable<T> {
    data: T[] = [];
    draining = false;
    data_waiters: (() => void)[] = [];
    constructor() {}
    push(item: T) {
        assert(!this.draining);
        this.data.push(item);
        const f = this.data_waiters.shift();
        if(f) {
            f();
        }
    }
    drain() {
        this.draining = true;
        for(const f of this.data_waiters) {
            f();
        }
    }
    get_core(): AsyncQueueResult<T> {
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
            assert(false);
        }
    }
    async get(): Promise<AsyncQueueResult<T>> {
        if(this.data.length > 0 || this.draining) {
            return this.get_core();
        } else {
            // data empty but the pool isn't draining; wait
            return new Promise<AsyncQueueResult<T>>(resolve => {
                this.data_waiters.push(() => {
                    resolve(this.get_core());
                });
            });
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

export class Funnel {
    count = 0;
    queue: (() => Promise<void>)[] = [];
    waiting: (() => void)[] = [];
    constructor(private limit: number) {}
    dispatch_promise(promise_factory: () => Promise<void>) {
        this.count++;
        (async () => {
            await promise_factory();
            this.count--;
            this.on_promise_finish();
        })();
    }
    on_promise_finish() {
        // run the next promise if needed
        if(this.queue.length > 0) {
            assert(this.count < this.limit);
            const promise_factory = this.queue.shift()!;
            this.dispatch_promise(promise_factory);
        } else {
            // notify anyone waiting
            for(const f of this.waiting) {
                f();
            }
        }
    }
    submit(promise_factory: () => Promise<void>) {
        if(this.count < this.limit) {
            // run it if we haven't maxed out
            this.dispatch_promise(promise_factory);
        } else {
            // otherwise queue it
            this.queue.push(promise_factory);
        }
    }
    async wait_all() {
        if(this.count == 0) {
            return;
        } else {
            return new Promise<void>(resolve => {
                this.waiting.push(resolve);
            });
        }
    }
}
