import { describe, test } from "vitest";

import * as fs from "fs";
import { globSync } from "glob";

import { parse_article } from "../src/components/wiki.js";

describe("parse wiki articles", () => {
    for (const file_path of globSync("wiki/articles/**/*.md", { withFileTypes: true })) {
        test(`${file_path.name} article should parse`, async () => {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            parse_article(null, content, {
                channels: {
                    resources: { id: null },
                    rules: { id: null },
                },
            } as any);
        });
    }
});
