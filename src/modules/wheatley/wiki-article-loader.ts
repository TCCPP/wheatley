import * as fs from "fs";

import { globIterate } from "glob";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

import { M } from "../../utils/debugging-and-logging.js";

const md = new MarkdownIt();

export const WIKI_WEB_ARTICLES_PATH = "wiki/wiki";
export const WIKI_BASE_URL = "https://tccpp.wiki";

export type WikiWebArticle = {
    path: string;
    url: string;
    bot_article: string;
    alias: string | string[] | undefined;
    page_title: string;
};

type WikiFrontmatter = {
    bot_article?: string;
    alias?: string | string[];
};

function extract_title_from_markdown(content: string): string | null {
    const tokens = md.parse(content, {});
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].type === "heading_open" && tokens[i].tag === "h1") {
            // The next token contains the heading content
            if (i + 1 < tokens.length && tokens[i + 1].type === "inline") {
                return tokens[i + 1].content;
            }
        }
    }
    return null;
}

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

            if (!frontmatter.bot_article) {
                continue;
            }

            const wiki_path = file_path_to_wiki_path(file_path.relative());
            const url = wiki_path_to_url(wiki_path);
            const page_title = extract_title_from_markdown(parsed.content) ?? wiki_path;

            articles.push({
                path: wiki_path,
                url,
                bot_article: frontmatter.bot_article,
                alias: frontmatter.alias,
                page_title,
            });
        } catch (e) {
            M.error(`Failed to parse wiki article ${file_path.fullpath()}: ${e}`);
        }
    }

    M.info(`Loaded ${articles.length} wiki web articles with bot_article frontmatter`);
    return articles;
}
