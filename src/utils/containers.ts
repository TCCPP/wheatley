import { strict as assert } from "assert";
import { M } from "./debugging-and-logging.js";
import { set_interval, clear_interval, set_timeout, clear_timeout } from "./node.js";
import { Wheatley } from "../wheatley.js";

export function force_clear_containers() {}

let had_error = false;

function set_clearing_interval(container: WeakRef<SelfClearingContainer>, interval_time: number) {
    let cleared = false;
    const interval: NodeJS.Timeout | null = set_interval(() => {
        let container_ref = container.deref();
        if (cleared && !had_error) {
            // This is a warning because it's a sign of cleanup not happening properly, but it's not a critical error
            M.warn(`Running cleared interval ${interval} at ${new Error().stack}`);
            had_error = true;
            return;
        }
        if (container_ref) {
            container_ref.sweep();
        } else if (interval !== null) {
            clear_interval(interval);
            cleared = true;
        }
        container_ref = undefined;
    }, interval_time);
    return interval;
}

abstract class SelfClearingContainer {
    private interval_ref: NodeJS.Timeout | null = null;
    constructor(protected interval: number) {
        this.interval_ref = set_clearing_interval(new WeakRef(this), interval);
    }
    destroy() {
        if (this.interval_ref !== null) {
            clear_interval(this.interval_ref);
        }
    }
    abstract sweep(): void;
}

export class SelfClearingSet<T> extends SelfClearingContainer {
    contents = new Map<T, number>();
    duration: number;
    private on_remove: (value: T) => void;
    constructor(duration: number, interval?: number, on_remove: (value: T) => void = () => {}) {
        super(interval ?? duration);
        this.duration = duration;
        this.on_remove = on_remove;
    }
    override destroy() {
        super.destroy();
        for (const [value, _] of this.contents) {
            this.on_remove(value);
        }
    }
    override sweep() {
        const now = Date.now();
        for (const [value, timestamp] of this.contents) {
            if (now - timestamp >= this.duration) {
                this.on_remove(value);
                this.contents.delete(value);
            }
        }
    }
    insert(value: T) {
        this.contents.set(value, Date.now());
    }
    remove(value: T) {
        this.contents.delete(value);
    }
    has(value: T) {
        return this.contents.has(value);
    }
    size() {
        return this.contents.size;
    }
}

export class SelfClearingMap<K, V> extends SelfClearingContainer {
    contents = new Map<K, [number, V]>();
    duration: number;
    on_remove: (key: K, value: V) => void;
    constructor(duration: number, interval?: number, on_remove: (key: K, value: V) => void = () => {}) {
        super(interval ?? duration);
        this.duration = duration;
        this.on_remove = on_remove;
    }
    override destroy() {
        super.destroy();
        for (const [key, [_, value]] of this.contents) {
            this.on_remove(key, value);
        }
    }
    override sweep() {
        const now = Date.now();
        for (const [key, [timestamp, value]] of this.contents) {
            if (now - timestamp >= this.duration) {
                this.on_remove(key, value);
                this.contents.delete(key);
            }
        }
    }
    set(key: K, value: V) {
        this.contents.set(key, [Date.now(), value]);
    }
    get(key: K) {
        const p = this.contents.get(key);
        if (p == undefined) {
            return undefined;
        }
        return p[1];
    }
    /*
    get(key: K, default_value?: V): V | undefined {
        if(this.contents.has(key)) {
            const p = this.contents.get(key);
            return p![1];
        } else {
            if(default_value) {
                this.set(key, default_value);
                return this.get(key);
            } else {
                return undefined;
            }
        }
    }
    */
    remove(key: K) {
        this.contents.delete(key);
    }
    has(key: K) {
        return this.contents.has(key);
    }
}

export class Mutex {
    locked = false;
    waiting: (() => void)[] = [];
    async lock() {
        if (this.locked) {
            await new Promise<void>(resolve => {
                // TODO: Is there an async break between promise call and callback call?
                this.waiting.push(resolve);
            });
            // entry in locks will remain, no need to re-add
        } else {
            this.locked = true;
        }
    }
    unlock() {
        if (this.waiting.length > 0) {
            this.waiting.shift()!();
        } else {
            this.locked = false;
        }
    }
}

// TODO: Could update this to be implemented in terms of Mutex
export class KeyedMutexSet<T> {
    locks = new Set<T>();
    waiting = new Map<T, (() => void)[]>();
    async lock(value: T) {
        if (this.locks.has(value)) {
            if (!this.waiting.has(value)) {
                this.waiting.set(value, []);
            }
            await new Promise<void>(resolve => {
                // TODO: Is there an async break between promise call and callback call?
                this.waiting.get(value)!.push(resolve);
            });
            // entry in locks will remain, no need to re-add
        } else {
            this.locks.add(value);
        }
    }
    unlock(value: T) {
        if (this.waiting.has(value)) {
            assert(this.waiting.get(value)!.length > 0); // If this fails, see TODO above ^^
            const resolve = this.waiting.get(value)!.shift()!;
            if (this.waiting.get(value)!.length == 0) {
                this.waiting.delete(value);
            }
            resolve();
        } else {
            this.locks.delete(value);
        }
    }
}

const INT_MAX = 2147483647;

export class SleepList<T, ID> {
    // timestamp to fire at, T
    list: [number, T][] = [];
    timer: NodeJS.Timeout | null = null;

    constructor(
        private wheatley: Wheatley,
        private handler: (item: T) => Promise<void>,
        private get_id: (item: T) => ID,
        private id_equal = (a: ID, b: ID) => a === b,
    ) {}

    destroy() {
        if (this.timer) {
            clear_timeout(this.timer);
        }
    }

    // Must be called from the timeout's callback
    async handle_timer() {
        this.timer = null;
        try {
            assert(this.list.length > 0, "Sleep list empty??");
            const [target_time, item] = this.list[0];
            // Make sure we're actually supposed to run. 100ms buffer, just to be generous.
            // This can happen for excessively long sleeps > INT_MAX ms
            if (target_time <= Date.now() + 100) {
                this.list.shift();
                await this.handler(item);
            }
        } catch (e) {
            this.wheatley.critical_error(e);
        } finally {
            this.reset_timer();
        }
    }

    reset_timer() {
        if (this.timer !== null) {
            clear_timeout(this.timer);
        }
        if (this.list.length > 0) {
            const delta = Math.max(this.list[0][0] - Date.now(), 0);
            this.timer = set_timeout(
                () => {
                    this.handle_timer()
                        .catch(this.wheatley.critical_error.bind(this.wheatley))
                        .finally(this.reset_timer.bind(this));
                },
                Math.min(delta, INT_MAX),
            );
        }
    }

    bulk_insert(items: [number, T][]) {
        this.list.push(...items);
        this.list = this.list.sort((a, b) => a[0] - b[0]);
        this.reset_timer();
    }

    insert(item: [number, T]) {
        this.list.push(item);
        let i = 0;
        // TODO: Binary search
        for (; i < this.list.length; i++) {
            if (this.list[i][0] >= item[0]) {
                break;
            }
        }
        this.list.splice(i, 0, item);
        this.reset_timer();
    }

    remove(id: ID) {
        this.list = this.list.filter(([_, entry]) => !this.id_equal(this.get_id(entry), id));
        this.reset_timer();
    }

    replace(id: ID, item: [number, T]) {
        this.list = this.list.filter(([_, entry]) => !this.id_equal(this.get_id(entry), id));
        this.insert(item);
    }
}
