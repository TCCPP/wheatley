import { strict as assert } from "assert";
import * as fs from "fs";
import { execFile, ExecFileOptions } from "child_process";
import * as path from "path";

export async function* walk_dir(dir: string): AsyncGenerator<string> {
    for (const f of await fs.promises.readdir(dir)) {
        const file_path = path.join(dir, f).replace(/\\/g, "/");
        if ((await fs.promises.stat(file_path)).isDirectory()) {
            yield* walk_dir(file_path);
        } else {
            yield file_path;
        }
    }
}

export async function directory_exists(path: string) {
    try {
        const stats = await fs.promises.stat(path);
        return stats.isDirectory();
    } catch (error) {
        return false;
    }
}

export async function file_exists(path: string) {
    try {
        const stats = await fs.promises.stat(path);
        return stats.isFile();
    } catch (error) {
        return false;
    }
}

export function exists_sync(path: string) {
    let exists = true;
    try {
        fs.accessSync(path, fs.constants.F_OK);
    } catch (e) {
        exists = false;
    }
    return exists;
}

export async function async_exec_file(
    file: string,
    args?: string[],
    options?: fs.ObjectEncodingOptions & ExecFileOptions,
    input?: string,
) {
    return new Promise<{ stdout: string | Buffer; stderr: string | Buffer }>((resolve, reject) => {
        const child = execFile(file, args, options, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
        if (!child.stdin) {
            reject("!child.stdin");
            assert(false);
        }
        child.stdin.write(input);
        child.stdin.end();
    });
}
