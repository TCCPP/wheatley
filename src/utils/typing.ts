// prettier-ignore
export type JSONValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | {[x: string]: JSONValue}
    | Array<JSONValue>;

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
