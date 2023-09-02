import { Arr, Iterables } from "./typing.js";

export function* zip<Ts extends Arr>(...args: Iterables<Ts>): Generator<Ts> {
    const iterators = args.map(arg => arg[Symbol.iterator]());
    let values = iterators.map(it => it.next());
    while (!values.some(value => value.done)) {
        yield values.map(value => value.value) as unknown as Ts;
        values = iterators.map(it => it.next());
    }
}

export function max<T, U>(fn: (x: T) => U, ...items: [T, ...T[]]) {
    let max_i = 0;
    let max_v = fn(items[0]);
    for (let i = 1; i < items.length; i++) {
        const v = fn(items[i]);
        if (v > max_v) {
            max_i = i;
            max_v = v;
        }
    }
    return items[max_i];
}

export function index_of_first_not_satisfying<T>(arr: T[], fn: (_: T) => boolean) {
    for (let i = 0; i < arr.length; i++) {
        if (!fn(arr[i])) {
            return i;
        }
    }
    return -1;
}
