import { describe, test } from "vitest";

import * as fs from "fs";
import * as path from "path";

import { is_article, parse_article, wiki_dir } from "../src/components/wiki.js";

function* walk_dir(dir: string): Generator<string> {
    // todo: duplicate
    for (const f of fs.readdirSync(dir)) {
        const file_path = path.join(dir, f).replace(/\\/g, "/");
        if (fs.statSync(file_path).isDirectory()) {
            yield* walk_dir(file_path);
        } else {
            yield file_path;
        }
    }
}

describe("parse wiki articles", () => {
    for (const file_path of walk_dir(wiki_dir)) {
        if (!is_article(file_path)) {
            continue;
        }
        const name = path.basename(file_path, path.extname(file_path));
        test(`${name} article should parse`, async () => {
            const content = await fs.promises.readFile(file_path, { encoding: "utf-8" });
            parse_article(null, content, {
                channels: {
                    resources: { id: null },
                    rules: { id: null },
                },
            } as any);
        });
    }
});
