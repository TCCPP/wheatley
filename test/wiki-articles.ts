import { describe, test } from "vitest";

import * as fs from "fs";
import matter from "gray-matter";
import { globSync } from "glob";

import { parse_article, wiki_articles_path, wiki_path } from "../src/components/wiki.js";

describe("parse wiki articles", () => {
    for (const file_path of globSync(`${wiki_articles_path}/articles/**/*.md`, { withFileTypes: true })) {
        test(`${file_path.name} article should parse`, async () => {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            parse_article(null, content, str => str);
        });
    }
    for (const file_path of globSync(`${wiki_path}/src/**/*.md`, { withFileTypes: true })) {
        test(`${file_path.name} article should parse`, async () => {
            const file_content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            const { data } = matter(file_content);
            if (data.preview) {
                parse_article(null, data.preview, str => str);
            }
        });
    }
});
