import * as Discord from "discord.js";
import * as moment from "moment";
import * as chalk from "chalk";
import * as fs from "fs";
import { MINUTE, zelis_id } from "../common";
import { strict as assert } from "assert";
import { decode_snowflake } from "../components/snowflake";

function get_caller_location() { // https://stackoverflow.com/a/53339452/15675011
    const e = new Error();
    if(!e.stack) {
        return "<error>";
    }
    const frame = e.stack.split("\n")[3];
    const line_number = frame.split(":").reverse()[1];
    const function_name = frame.split(" ")[5];
    return function_name + ":" + line_number;
}

export class M {
    static get_timestamp() {
        return moment().format("MM.DD.YY HH:mm:ss");
    }
    static log(...args: any[]) {
        process.stdout.write(`[${M.get_timestamp()}] [log]   `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static debug(...args: any[]) {
        process.stdout.write(`${chalk.gray(`[${M.get_timestamp()}] [debug]`)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static info(...args: any[]) {
        process.stdout.write(`${chalk.blueBright(`[${M.get_timestamp()}] [info] `)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static warn(...args: any[]) {
        process.stdout.write(`${chalk.yellowBright(`[${M.get_timestamp()}] [warn] `)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static error(...args: any[]) {
        process.stdout.write(`${chalk.redBright(`[${M.get_timestamp()}] [error]`)} `);
        console.log(...args);
        console.trace();
    }
}

export function send_long_message(channel: Discord.TextChannel, msg: string) {
    if(msg.length > 2000) {
        const lines = msg.split("\n");
        let partial = "";
        const queue: string[] = [];
        while(lines.length > 0) {
            if(partial.length + lines[0].length + 1 <= 2000) {
                if(partial != "") partial += "\n";
                partial += lines.shift();
            } else {
                queue.push(partial);
                partial = "";
            }
        }
        if(partial != "") queue.push(partial);
        const send_next = () => {
            if(queue.length > 0) {
                channel.send(queue.shift()!)
                    .then(send_next)
                    .catch(M.error);
            }
        };
        send_next();
    } else {
        channel.send(msg)
            .catch(M.error);
    }
}

function round(n: number, p: number) {
    return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
}

function pluralize(n: number, word: string) {
    if(n == 1) {
        return `${round(n, 2)} ${word}`;
    } else {
        return `${round(n, 2)} ${word}s`;
    }
}

export function diff_to_human(diff: number) {
    if(diff >= MINUTE) {
        return `${pluralize(Math.floor(diff / MINUTE), "minute")} ${pluralize(diff % MINUTE / 1000, "second")}`;
    } else {
        return `${pluralize(diff / 1000, "second")}`;
    }
}

const code_re = /`[^`]+`(?!`)/gi;
const code_block_re = /```(?:[^`]|`(?!``))+```/gi;

export function parse_out(message: string) {
    message = message.replace(code_re, message);
    message = message.replace(code_block_re, message);
    return message;
}

export function exists_sync(path: string) {
    let exists = true;
    try {
        fs.accessSync(path, fs.constants.F_OK);
    } catch(e) {
        exists = false;
    }
    return exists;
}

type PotentiallyPartial = Discord.User | Discord.PartialUser
                        | Discord.GuildMember | Discord.PartialGuildMember
                        | Discord.Message | Discord.PartialMessage
                        | Discord.MessageReaction | Discord.PartialMessageReaction;
export async function departialize<T extends PotentiallyPartial,
                                   R extends ReturnType<T["fetch"]>>(thing: T): Promise<R> {
    if(thing.partial) {
        return await thing.fetch() as R;
    } else {
        return thing as any as R;
    }
}

export function get_url_for(channel: Discord.GuildChannel | Discord.TextChannel | Discord.ThreadChannel) {
    return `https://discord.com/channels/${channel.guildId}/${channel.id}`;
}

export async function delay(n: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, n));
}

export class SelfClearingSet<T> {
    contents = new Map<T, number>();
    duration: number;
    constructor(duration: number, interval?: number) {
        this.duration = duration;
        setInterval(this.sweep.bind(this), interval ?? this.duration);
    }
    sweep() {
        const now = Date.now();
        for(const [value, timestamp] of this.contents) {
            if(now - timestamp >= this.duration) {
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
}

export class SelfClearingMap<K, V> {
    contents = new Map<K, [number, V]>();
    duration: number;
    constructor(duration: number, interval?: number) {
        this.duration = duration;
        setInterval(this.sweep.bind(this), interval ?? this.duration);
    }
    sweep() {
        const now = Date.now();
        for(const [key, [timestamp, _]] of this.contents) {
            if(now - timestamp >= this.duration) {
                this.contents.delete(key);
            }
        }
    }
    set(key: K, value: V) {
        this.contents.set(key, [Date.now(), value]);
    }
    get(key: K) {
        const p = this.contents.get(key);
        if(p == undefined) return undefined;
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
        if(this.locked) {
            await new Promise<void>(resolve => {// TODO: Is there an async break between promise call and callback call?
                this.waiting.push(resolve);
            });
            // entry in locks will remain, no need to re-add
        } else {
            this.locked = true;
        }
    }
    unlock() {
        if(this.waiting.length > 0) {
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
        if(this.locks.has(value)) {
            if(!this.waiting.has(value)) {
                this.waiting.set(value, []);
            }
            await new Promise<void>(resolve => {// TODO: Is there an async break between promise call and callback call?
                this.waiting.get(value)!.push(resolve);
            });
            // entry in locks will remain, no need to re-add
        } else {
            this.locks.add(value);
        }
    }
    unlock(value: T) {
        if(this.waiting.has(value)) {
            assert(this.waiting.get(value)!.length > 0); // If this fails, see TODO above ^^
            M.debug(this.waiting.get(value)); // TODO: Remove?
            const resolve = this.waiting.get(value)!.shift()!;
            if(this.waiting.get(value)!.length == 0) {
                this.waiting.delete(value);
            }
            resolve();
        } else {
            this.locks.delete(value);
        }
    }
}

let client: Discord.Client;
let zelis : Discord.User | undefined | null;
let has_tried_fetch_zelis = false;

async function get_zelis() {
    if(!has_tried_fetch_zelis) {
        zelis = await client.users.fetch(zelis_id);
        has_tried_fetch_zelis = true;
    }
    return zelis !== undefined && zelis !== null;
}

export function init_debugger(_client: Discord.Client) {
    client = _client;
}

export async function critical_error(...args: any[]) {
    M.error(...args);
    try {
        if(await get_zelis()) {
            const strs = [];
            for(const arg of args) {
                try {
                    strs.push(arg.toString());
                } catch {
                    try {
                        strs.push(String(arg));
                    } catch { void(0); }
                }
            }
            zelis!.send(`Critical error occurred: ${strs.join(" ")}`);
        }
    } catch { void(0); }
}

export function denullify<T>(x: T | null): T {
    assert(x !== null);
    return x;
}

export function textchannelify(x: Discord.Channel): Discord.TextBasedChannel {
    assert(x.isTextBased());
    return x;
}

export async function fetch_text_channel(id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const channel = await client.channels.fetch(id);
    assert(channel && channel instanceof Discord.TextChannel);
    return channel;
}

export async function fetch_forum_channel(id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const channel = await client.channels.fetch(id);
    assert(channel && channel instanceof Discord.ForumChannel);
    return channel;
}

export async function fetch_thread_channel(channel: Discord.TextChannel, id: string) {
    // TODO: Using the client from init_debugger is very ugly.
    const thread = await channel.threads.fetch(id);
    assert(thread && thread instanceof Discord.ThreadChannel);
    return thread;
}

export function get_tag(channel: Discord.ForumChannel, name: string) {
    const candidates = channel.availableTags.filter(tag => tag.name == name);
    assert(candidates.length == 1, "Did someone change the tag name??");
    return candidates[0];
}

export async function fetch_active_threads(forum: Discord.ForumChannel) {
    const {threads, hasMore} = await forum.threads.fetchActive();
    assert(!hasMore); // todo: how to handle
    return threads;
}

export async function fetch_inactive_threads_time_limit(forum: Discord.ForumChannel, soft_limit?: number) {
    let before: string | undefined = undefined;
    const now = Date.now();
    const thread_entries: [string, Discord.ThreadChannel][] = [];
    while(true) {
        const {threads, hasMore} = await forum.threads.fetchArchived({ before });
        thread_entries.push(...threads);
        // The type annotation is needed because of a typescript bug
        // https://github.com/microsoft/TypeScript/issues/51115
        const last: Discord.ThreadChannel = threads.last()!;
        before = last.id;
        if(!hasMore || (soft_limit && Math.abs(now - denullify(last.createdAt).getTime()) >= soft_limit)) {
            break;
        }
    }
    return new Discord.Collection(thread_entries);
}

export async function fetch_all_threads_time_limit(forum: Discord.ForumChannel, soft_limit?: number) {
    const threads = new Discord.Collection([
        ...await fetch_active_threads(forum),
        ...await fetch_inactive_threads_time_limit(forum, soft_limit)
    ]);
    return threads;
}

export async function fetch_inactive_threads_count(forum: Discord.ForumChannel, count: number) {
    let before: string | undefined = undefined;
    const thread_entries: [string, Discord.ThreadChannel][] = [];
    while(true) {
        const {threads, hasMore} = await forum.threads.fetchArchived({ before, limit: Math.min(count, 100) });
        thread_entries.push(...threads);
        // The type annotation is needed because of a typescript bug
        // https://github.com/microsoft/TypeScript/issues/51115
        const last: Discord.ThreadChannel = threads.last()!;
        before = last.id;
        count -= threads.size;
        if(!hasMore || count <= 0) {
            break;
        }
    }
    return new Discord.Collection(thread_entries);
}

export async function fetch_all_threads_archive_count(forum: Discord.ForumChannel, count: number) {
    const threads = new Discord.Collection([
        ...await fetch_active_threads(forum),
        ...await fetch_inactive_threads_count(forum, count)
    ]);
    return threads;
}
