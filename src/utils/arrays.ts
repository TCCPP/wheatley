import { zip } from "./iterables.js";

// arr.filter(x => x !== null) returns a (T | null)[] even though it is a T[]
// Apparently the idiomatic solution is arr.filter((x): x is T => x !== null), but this is shorter (and the type
// predicate also isn't type checked so it doesn't seem safe to me)
export function remove<U, V extends U>(arr: Readonly<U[]>, v: Readonly<V>) {
    return arr.filter(item => item !== v) as Exclude<U, V extends null | undefined ? V : never>[];
}
// eslint-disable-next-line
// https://www.typescriptlang.org/play?#code/KYDwDg9gTgLgBAMwK4DsDGMCWEVysAWwgDdgAeAVQBo4A1OUGYFAEwGc4KA+ACgEMoUAFycA2gF0axEbQCUcAN4AoOKrzAYSKLgFQAdAkwAbJlB6YmBOAF4ucC4TgBCa9bjF5fDgFEQaI0gs5NR0DCBMrBwoSEZGcAA+cKhBhijALHAA-KEiaaRQXBIA3EoAvkpKQf4CwHBoOGzwuiI8jVCYKADmCXDRsbLFFfUojXAgNupEpPyCNH1GsiUA9EtqcAB6mUMN8ACeE-hTwDNQNABECBAQZ4tKK2ubFUA

export function intersection<V>(a: Readonly<V[]>, b: Readonly<V[]>): V[] {
    const b_set = new Set(b);
    return [...a].filter(item => b_set.has(item));
}

export function equal<V>(a: Readonly<V[]>, b: Readonly<V[]>): boolean {
    // TODO: Rewrite with .every and no [...zip()] once on node 22
    return a.length === b.length && [...zip(a.toSorted(), b.toSorted())].every(([v0, v1]) => v0 == v1);
}

export function setxor<V>(a: Readonly<Set<V>>, b: Readonly<Set<V>>): Set<V> {
    return new Set([...[...a].filter(item => !b.has(item)), ...[...b].filter(item => !a.has(item))]);
}

export function set_equal<V>(a: Readonly<Set<V>>, b: Readonly<Set<V>>): boolean {
    // TODO: Rewrite with .union once on node 22
    return a.size === b.size && [...a].every(v => b.has(v));
}

export function partition<V>(arr: Readonly<V[]>, predicate: (item: V) => boolean): [V[], V[]] {
    const pass: V[] = [];
    const fail: V[] = [];
    for (const item of arr) {
        if (predicate(item)) {
            pass.push(item);
        } else {
            fail.push(item);
        }
    }
    return [pass, fail];
}

export function get_random_array_element<T>(arr: Readonly<T[]>) {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

export function* chunks<T>(arr: Readonly<T[]>, n: number) {
    for (let i = 0; i < arr.length; i += n) {
        yield arr.slice(i, i + n);
    }
}
