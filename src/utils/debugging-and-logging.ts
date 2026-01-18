import { findSourceMap } from "node:module";

import moment from "moment";
import chalk from "chalk";
import * as stacktrace from "stack-trace";

function map_to_source(file: string, line: number, column: number): { file: string; line: number; column: number } {
    const source_map = findSourceMap(file);
    if (source_map) {
        const origin = source_map.findEntry(line, column);
        if ("originalSource" in origin) {
            return {
                file: origin.originalSource,
                line: origin.originalLine,
                column: origin.originalColumn,
            };
        }
    }
    return { file, line, column };
}

function get_caller_location() {
    // https://stackoverflow.com/a/53339452/15675011
    const trace = stacktrace.get();
    const raw_file = trace[2].getFileName();
    const raw_line = trace[2].getLineNumber();
    const raw_col = trace[2].getColumnNumber();
    const fn: string | null = trace[2].getFunctionName();
    if (!raw_file) {
        return fn || "<unknown>";
    }
    const { file, line, column } = map_to_source(raw_file, raw_line, raw_col);
    return `${fn || ""} ${file}:${line}:${column}`.trim();
}

export class M {
    static get_timestamp() {
        return moment().format("YYYY.MM.DD HH:mm:ss.SSS");
    }
    static log(...args: any[]) {
        process.stdout.write(`   [${M.get_timestamp()}] [log]   `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static debug(...args: any[]) {
        process.stdout.write(`${chalk.gray(`🛠️ [${M.get_timestamp()}] [debug]`)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static info(...args: any[]) {
        process.stdout.write(`${chalk.blueBright(`ℹ️ [${M.get_timestamp()}] [info] `)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static warn(...args: any[]) {
        process.stdout.write(`${chalk.yellowBright(`⚠️ [${M.get_timestamp()}] [warn] `)} `);
        console.log(...args, `(from: ${get_caller_location()})`);
    }
    static error(...args: any[]) {
        process.stdout.write(`${chalk.redBright(`🛑 [${M.get_timestamp()}] [error]`)} `);
        console.log(...args);
        console.group("Error");
        for (const arg of args) {
            if (arg instanceof Error && arg.stack) {
                console.log(arg.stack);
            }
        }
        console.trace();
        console.groupEnd();
    }
}
