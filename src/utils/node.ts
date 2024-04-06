import { M } from "./debugging-and-logging.js";

const DEBUG_TIMEOUTS = true;

export function set_interval<Args extends any[]>(
    callback: (...args: Args) => void,
    ms?: number,
    ...args: Args
): NodeJS.Timeout {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (DEBUG_TIMEOUTS) {
        M.debug("set_interval", ms);
        // console.log(new Error().stack);
    }
    return setInterval(callback, ms, ...args);
}

export function set_timeout<Args extends any[]>(
    callback: (...args: Args) => void,
    ms?: number,
    ...args: Args
): NodeJS.Timeout {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (DEBUG_TIMEOUTS) {
        M.debug("set_timeout", ms);
        // console.log(new Error().stack);
    }
    return setTimeout(callback, ms, ...args);
}

export function clear_interval(id: NodeJS.Timeout | string | number | undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (DEBUG_TIMEOUTS) {
        M.debug("clear_interval", id);
        // console.log(new Error().stack);
    }
    clearInterval(id);
}

export function clear_timeout(id: NodeJS.Timeout | string | number | undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (DEBUG_TIMEOUTS) {
        M.debug("clear_timeout", id);
        // console.log(new Error().stack);
    }
    clearTimeout(id);
}
