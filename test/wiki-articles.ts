import { describe, test } from "vitest";

import * as fs from "fs";
import matter from "gray-matter";
import { globSync } from "glob";

import { parse_article, WIKI_ARTICLES_PATH } from "../src/components/wiki.js";

describe("parse wiki articles", () => {
    for (const file_path of globSync(`${WIKI_ARTICLES_PATH}/**/*.md`, { withFileTypes: true })) {
        test(`${file_path.name} article should parse`, async () => {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            parse_article(null, content, str => str);
        });
    }
});
