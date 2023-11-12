import moment from "moment";
import chalk from "chalk";
import * as Discord from "discord.js";
import * as Sentry from "@sentry/node";
import { zelis_id } from "../wheatley.js";
import { to_string } from "./strings.js";
import { send_long_message } from "./discord.js";

function get_caller_location() {
    // https://stackoverflow.com/a/53339452/15675011
    const e = new Error();
    if (!e.stack) {
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

// FIXME: eliminate this hackery
export let client: Discord.Client;
let zelis: Discord.User | undefined | null;
let has_tried_fetch_zelis = false;

async function get_zelis() {
    if (!has_tried_fetch_zelis) {
        zelis = await client.users.fetch(zelis_id);
        has_tried_fetch_zelis = true;
    }
    return zelis !== undefined && zelis !== null;
}

export function init_debugger(_client: Discord.Client) {
    client = _client;
}

export function critical_error(arg: any) {
    M.error(arg);
    get_zelis()
        .then(zelis_found => {
            if (zelis_found) {
                send_long_message(zelis!.dmChannel!, `Critical error occurred: ${to_string(arg)}`).catch(() => void 0);
            }
        })
        .catch(() => void 0)
        .finally(() => {
            if (arg instanceof Error) {
                Sentry.captureException(arg);
            } else {
                Sentry.captureMessage(to_string(arg));
            }
        });
}

export function ignorable_error(arg: any) {
    M.error(arg);
    get_zelis()
        .then(zelis_found => {
            if (zelis_found) {
                zelis!.send(`Ignorable error occurred: ${to_string(arg)}`).catch(() => void 0);
            }
        })
        .catch(() => void 0)
        .finally(() => {
            if (arg instanceof Error) {
                Sentry.captureException(arg);
            } else {
                Sentry.captureMessage(to_string(arg));
            }
        });
}

export function milestone(message: string) {
    M.info(message);
    get_zelis()
        .then(zelis_found => {
            if (zelis_found) {
                zelis!.send(message).catch(() => void 0);
            }
        })
        .catch(() => void 0)
        .finally(() => {
            Sentry.captureMessage(message);
        });
}
