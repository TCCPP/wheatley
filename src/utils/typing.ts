// prettier-ignore
export type JSONValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | {[x: string]: JSONValue}
    | Array<JSONValue>;

// arr.filter(x => x !== null) returns a (T | null)[] even though it is a T[]
// Apparently the idiomatic solution is arr.filter((x): x is T => x !== null), but this is shorter (and the type
// predicate also isn't type checked so it doesn't seem safe to me)
export function remove<U, V extends U>(arr: U[], v: V) {
    return arr.filter(item => item !== v) as Exclude<U, V extends null | undefined ? V : never>[];
}
// eslint-disable-next-line
// https://www.typescriptlang.org/play?#code/KYDwDg9gTgLgBAMwK4DsDGMCWEVysAWwgDdgAeAVQBo4A1OUGYFAEwGc4KA+ACgEMoUAFycA2gF0axEbQCUcAN4AoOKrzAYSKLgFQAdAkwAbJlB6YmBOAF4ucC4TgBCa9bjF5fDgFEQaI0gs5NR0DCBMrBwoSEZGcAA+cKhBhijALHAA-KEiaaRQXBIA3EoAvkpKQf4CwHBoOGzwuiI8jVCYKADmCXDRsbLFFfUojXAgNupEpPyCNH1GsiUA9EtqcAB6mUMN8ACeE-hTwDNQNABECBAQZ4tKK2ubFUA

export function intersection<V>(a: V[], b: V[]): V[] {
    const B = new Set(b);
    return [...a].filter(item => B.has(item));
}

export type Append<T extends unknown[], U> = [...T, U];
export type Prepend<T extends unknown[], U> = [U, ...T];

export type ConditionalOptional<C extends true | false, T> = C extends true ? T : T | undefined;
export type ConditionalNull<C extends true | false, T> = C extends true ? T : T | null;

export type MoreThanOne<T> = [T, T, ...T[]];

// see <https://github.com/microsoft/TypeScript/issues/31501>
export type DistributedOmit<T, K extends PropertyKey> = T extends T ? Pick<T, Exclude<keyof T, K>> : never;

export type Arr = readonly unknown[];
export type Iterables<Ts> = {
    [K in keyof Ts]: Iterable<Ts[K]>;
};
