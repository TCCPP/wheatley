import { strict as assert } from "assert";
import { M } from "./debugging-and-logging.js";
import { set_timeout } from "./node.js";

// Round n to p decimal places
export function round(n: number, p: number) {
    return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
}

export function floor(n: number, p: number) {
    return Math.floor(n * Math.pow(10, p)) / Math.pow(10, p);
}

// wait n milliseconds
export async function delay(n: number): Promise<void> {
    return new Promise<void>(resolve => set_timeout(resolve, n));
}

export function unwrap<T>(x: T): T & NonNullable<unknown> {
    assert(x !== null && x !== undefined);
    return x;
}

export function assert_type<T>(x: unknown, type: new (...args: any[]) => T): T {
    assert(x instanceof type);
    return x;
}

function compare<T>(a: T, b: T) {
    if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    } else {
        return 0;
    }
}

// Utility for Array.prototype.sort
export function ascending<T, P>(a: T, b: T, pick?: (item: T) => P) {
    if (pick) {
        return compare(pick(a), pick(b));
    } else {
        return compare(a, b);
    }
}

// Utility for Array.prototype.sort
export function descending<T, P>(a: T, b: T, pick?: (item: T) => P) {
    return -ascending(a, b, pick);
}
