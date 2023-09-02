import { strict as assert } from "assert";

// Round n to p decimal places
export function round(n: number, p: number) {
    return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
}

export function floor(n: number, p: number) {
    return Math.floor(n * Math.pow(10, p)) / Math.pow(10, p);
}

// wait n milliseconds
export async function delay(n: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, n));
}

export function unwrap<T>(x: T | null | undefined): T {
    assert(x !== null && x !== undefined);
    return x;
}
