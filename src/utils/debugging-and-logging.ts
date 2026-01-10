import moment from "moment";
import chalk from "chalk";
import * as stacktrace from "stack-trace";

function get_caller_location() {
    // https://stackoverflow.com/a/53339452/15675011
    const trace = stacktrace.get();
    const file = trace[2].getFileName();
    const line = trace[2].getLineNumber();
    const col = trace[2].getColumnNumber();
    const fn: string | null = trace[2].getFunctionName();
    return `${fn || ""} ${file}:${line}:${col}`.trim();
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
