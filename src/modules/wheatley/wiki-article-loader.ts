import * as fs from "fs";

import { globIterate } from "glob";
import matter from "gray-matter";

import { M } from "../../utils/debugging-and-logging.js";

export const WIKI_WEB_ARTICLES_PATH = "wiki/wiki";
export const WIKI_BASE_URL = "https://tccpp.wiki";

export type WikiWebArticle = {
    path: string;
    url: string;
    preview: string;
    alias: string | string[] | undefined;
};

type WikiFrontmatter = {
    preview?: string;
    alias?: string | string[];
};

function file_path_to_wiki_path(file_path: string): string {
    // Remove the base path and .md extension
    // e.g., "wiki/wiki/resources/general/asan.md" -> "resources/general/asan"
    let path = file_path;
    if (path.startsWith(WIKI_WEB_ARTICLES_PATH + "/")) {
        path = path.substring(WIKI_WEB_ARTICLES_PATH.length + 1);
    }
    if (path.endsWith(".md")) {
        path = path.substring(0, path.length - 3);
    }
    // Remove "index" suffix for directory index pages
    if (path.endsWith("/index")) {
        path = path.substring(0, path.length - 6);
    } else if (path === "index") {
        path = "";
    }
    return path;
}

function wiki_path_to_url(wiki_path: string): string {
    return `${WIKI_BASE_URL}/${wiki_path}`;
}

export async function load_wiki_web_articles(): Promise<WikiWebArticle[]> {
    const articles: WikiWebArticle[] = [];

    try {
        await fs.promises.access(WIKI_WEB_ARTICLES_PATH);
    } catch {
        M.info(`Wiki web articles directory not found at ${WIKI_WEB_ARTICLES_PATH}, skipping`);
        return articles;
    }

    for await (const file_path of globIterate(`${WIKI_WEB_ARTICLES_PATH}/**/*.md`, { withFileTypes: true })) {
        try {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            const parsed = matter(content);
            const frontmatter = parsed.data as WikiFrontmatter;

            if (!frontmatter.preview) {
                continue;
            }

            const wiki_path = file_path_to_wiki_path(file_path.relative());
            const url = wiki_path_to_url(wiki_path);

            articles.push({
                path: wiki_path,
                url,
                preview: frontmatter.preview,
                alias: frontmatter.alias,
            });
        } catch (e) {
            M.error(`Failed to parse wiki article ${file_path.fullpath()}: ${e}`);
        }
    }

    M.info(`Loaded ${articles.length} wiki web articles with previews`);
    return articles;
}
