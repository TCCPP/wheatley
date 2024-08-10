// arr.filter(x => x !== null) returns a (T | null)[] even though it is a T[]
// Apparently the idiomatic solution is arr.filter((x): x is T => x !== null), but this is shorter (and the type
// predicate also isn't type checked so it doesn't seem safe to me)
export function remove<U, V extends U>(arr: U[], v: V) {
    return arr.filter(item => item !== v) as Exclude<U, V extends null | undefined ? V : never>[];
}
// eslint-disable-next-line
// https://www.typescriptlang.org/play?#code/KYDwDg9gTgLgBAMwK4DsDGMCWEVysAWwgDdgAeAVQBo4A1OUGYFAEwGc4KA+ACgEMoUAFycA2gF0axEbQCUcAN4AoOKrzAYSKLgFQAdAkwAbJlB6YmBOAF4ucC4TgBCa9bjF5fDgFEQaI0gs5NR0DCBMrBwoSEZGcAA+cKhBhijALHAA-KEiaaRQXBIA3EoAvkpKQf4CwHBoOGzwuiI8jVCYKADmCXDRsbLFFfUojXAgNupEpPyCNH1GsiUA9EtqcAB6mUMN8ACeE-hTwDNQNABECBAQZ4tKK2ubFUA

export function intersection<V>(a: V[], b: V[]): V[] {
    const b_set = new Set(b);
    return [...a].filter(item => b_set.has(item));
}

export function setxor<V>(a: Set<V>, b: Set<V>): Set<V> {
    return new Set([...[...a].filter(item => !b.has(item)), ...[...b].filter(item => !a.has(item))]);
}

export function partition<V>(arr: V[], predicate: (item: V) => boolean): [V[], V[]] {
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

export function get_random_array_element<T>(arr: T[]) {
    return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

export function* chunks<T>(arr: T[], n: number) {
    for (let i = 0; i < arr.length; i += n) {
        yield arr.slice(i, i + n);
    }
}
