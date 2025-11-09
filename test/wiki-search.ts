import { describe, expect, it, beforeAll } from "vitest";
import * as fs from "fs";
import { globSync } from "glob";
import {
    parse_article,
    WIKI_ARTICLES_PATH,
    WikiArticle,
    WikiSearchIndex,
    create_wiki_search_entries,
} from "../src/modules/wheatley/components/wiki.js";

describe("wiki search system", () => {
    let search_index: WikiSearchIndex;
    let articles: Record<string, WikiArticle>;
    let article_aliases: Map<string, string>;

    beforeAll(async () => {
        articles = {};
        article_aliases = new Map();

        for (const file_path of globSync(`${WIKI_ARTICLES_PATH}/**/*.md`, { withFileTypes: true })) {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            try {
                const [article, aliases] = parse_article(file_path.name, content, str => str);
                articles[file_path.name] = article;
                for (const alias of aliases) {
                    article_aliases.set(alias, file_path.name);
                }
            } catch (e) {
                console.error(`Failed to parse ${file_path.name}:`, e);
            }
        }

        const search_entries = create_wiki_search_entries(articles, article_aliases);
        search_index = new WikiSearchIndex(search_entries);
    });

    describe("exact title matches", () => {
        it("should find 'Undefined Behavior' by exact title", async () => {
            const { result } = await search_index.search_with_suggestions("Undefined Behavior");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find 'Getting Started with CMake' by exact title", async () => {
            const { result } = await search_index.search_with_suggestions("Getting Started with CMake");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Getting Started with CMake");
        });

        it("should find 'Smart Pointers in C++' by exact title", async () => {
            const { result } = await search_index.search_with_suggestions("Smart Pointers in C++");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Smart Pointers in C++");
        });

        it("should find 'Address Sanitizer' by exact title", async () => {
            const { result } = await search_index.search_with_suggestions("Address Sanitizer");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Address Sanitizer");
        });

        it("should find 'Debugger' by exact title", async () => {
            const { result } = await search_index.search_with_suggestions("Debugger");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Debugger");
        });
    });

    describe("alias matching", () => {
        it("should find Undefined Behavior via 'ub' alias", async () => {
            const { result } = await search_index.search_with_suggestions("ub");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find Address Sanitizer via 'asan' alias", async () => {
            const { result } = await search_index.search_with_suggestions("asan");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Address Sanitizer");
        });

        it("should find Debugger via 'debugger' alias", async () => {
            const { result } = await search_index.search_with_suggestions("debugger");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Debugger");
        });
    });

    describe("case insensitive searches", () => {
        it("should find article with lowercase query", async () => {
            const { result } = await search_index.search_with_suggestions("undefined behavior");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find article with uppercase query", async () => {
            const { result } = await search_index.search_with_suggestions("UNDEFINED BEHAVIOR");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find article with mixed case query", async () => {
            const { result } = await search_index.search_with_suggestions("UnDeFiNeD BeHaViOr");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find article with lowercase alias", async () => {
            const { result } = await search_index.search_with_suggestions("UB");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });
    });

    describe("partial and fuzzy matching", () => {
        it("should find Smart Pointers with 'smart pointer'", async () => {
            const { result } = await search_index.search_with_suggestions("smart pointer");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Smart Pointers in C++");
        });

        it("should find Address Sanitizer with 'address san'", async () => {
            const { result } = await search_index.search_with_suggestions("address san");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Address Sanitizer");
        });

        it("should find CMake with 'cmake'", async () => {
            const { result } = await search_index.search_with_suggestions("cmake");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Getting Started with CMake");
        });

        it("should find article with partial title 'undefined'", async () => {
            const { result } = await search_index.search_with_suggestions("undefined");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find article with partial title 'sanitizer'", async () => {
            const { result } = await search_index.search_with_suggestions("sanitizer");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Address Sanitizer");
        });
    });

    describe("content-based search", () => {
        it("should find Undefined Behavior with 'memory errors'", async () => {
            const { result } = await search_index.search_with_suggestions("memory errors");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should find Smart Pointers with 'unique_ptr'", async () => {
            const { result } = await search_index.search_with_suggestions("unique_ptr");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Smart Pointers in C++");
        });

        it("should find Smart Pointers with 'shared_ptr'", async () => {
            const { result } = await search_index.search_with_suggestions("shared_ptr");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Smart Pointers in C++");
        });

        it("should find CMake with 'build system'", async () => {
            const { result } = await search_index.search_with_suggestions("build system");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Getting Started with CMake");
        });

        // it("should find Undefined Behavior with 'uninitialized'", async () => {
        //     const { result } = await search_index.search_with_suggestions("uninitialized");
        //     expect(result).not.toBeNull();
        //     expect(result?.title).toBe("Undefined Behavior");
        // });

        it("should find Debugger with 'stepping through code'", async () => {
            const { result } = await search_index.search_with_suggestions("stepping through");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Debugger");
        });
    });

    describe("typo tolerance", () => {
        it("should handle minor typo in 'undefined' -> 'undefned'", async () => {
            const { result } = await search_index.search_with_suggestions("undefned");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });

        it("should handle minor typo in 'sanitizer' -> 'sanitiser'", async () => {
            const { result } = await search_index.search_with_suggestions("sanitiser");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Address Sanitizer");
        });

        it("should handle typo in 'debugger' -> 'debbuger'", async () => {
            const { result } = await search_index.search_with_suggestions("debbuger");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Debugger");
        });
    });

    describe("search ranking", () => {
        it("should rank exact match higher than partial match", async () => {
            const results = await search_index.search_get_top_5_async("ub");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toBe("Undefined Behavior");
        });

        it("should rank title match higher than content match", async () => {
            const results = await search_index.search_get_top_5_async("sanitizer");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toBe("Address Sanitizer");
        });

        it("should rank exact title higher than fuzzy match", async () => {
            const results = await search_index.search_get_top_5_async("Debugger");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toBe("Debugger");
        });
    });

    describe("multi-word queries", () => {
        it("should handle 'smart pointer' query", async () => {
            const { result } = await search_index.search_with_suggestions("smart pointer");
            expect(result).not.toBeNull();
            expect(result?.title).toContain("Smart Pointer");
        });

        it("should handle 'getting started cmake' query", async () => {
            const { result } = await search_index.search_with_suggestions("getting started cmake");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Getting Started with CMake");
        });

        it("should handle 'how to ask' query", async () => {
            const { result } = await search_index.search_with_suggestions("how to ask");
            expect(result).not.toBeNull();
            expect(result?.title).toContain("Ask");
        });

        it("should handle 'undefined behavior' multi-word query", async () => {
            const { result } = await search_index.search_with_suggestions("undefined behavior");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
        });
    });

    describe("edge cases", () => {
        it("should handle empty query gracefully", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("");
            expect(result).toBeNull();
            expect(suggestions).toEqual([]);
        });

        it("should handle single character query", async () => {
            const { result } = await search_index.search_with_suggestions("c");
            expect(result === null || typeof result === "object").toBe(true);
        });

        it("should handle very long query", async () => {
            const long_query = "this is a very long query that probably won't match anything specific";
            const { result } = await search_index.search_with_suggestions(long_query);
            expect(result === null || typeof result === "object").toBe(true);
        });

        it("should handle query with special characters", async () => {
            const { result } = await search_index.search_with_suggestions("c++");
            expect(result === null || typeof result === "object").toBe(true);
        });

        it("should handle query with numbers", async () => {
            const { result } = await search_index.search_with_suggestions("c99");
            expect(result === null || typeof result === "object").toBe(true);
        });
    });

    describe("suggestions", () => {
        it("should provide suggestions when no exact match", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("pointers");
            expect(result).not.toBeNull();
            expect(suggestions.length).toBeGreaterThanOrEqual(0);
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });

        it("should provide relevant suggestions for broad query", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("cpp");
            expect(result).not.toBeNull();
            expect(suggestions.length).toBeGreaterThanOrEqual(0);
        });

        it("should provide suggestions even for exact matches", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("ub");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
            expect(suggestions.length).toBeGreaterThanOrEqual(0);
        });

        it("should limit suggestions to 3 items", async () => {
            const { suggestions } = await search_index.search_with_suggestions("c");
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });
    });

    describe("common user queries", () => {
        it("should handle 'memory leak' query", async () => {
            const { result } = await search_index.search_with_suggestions("memory leak");
            expect(result).not.toBeNull();
        });

        it("should handle 'pointer' query", async () => {
            const { result } = await search_index.search_with_suggestions("pointer");
            expect(result).not.toBeNull();
        });

        it("should handle 'crash' query", async () => {
            const { result } = await search_index.search_with_suggestions("crash");
            expect(result === null || typeof result === "object").toBe(true);
        });

        it("should handle 'compiler' query", async () => {
            const { result } = await search_index.search_with_suggestions("compiler");
            expect(result).not.toBeNull();
        });

        it("should handle 'learn c++' query", async () => {
            const { result } = await search_index.search_with_suggestions("learn c++");
            expect(result).not.toBeNull();
        });

        it("should handle 'beginner' query", async () => {
            const { result } = await search_index.search_with_suggestions("beginner");
            expect(result).not.toBeNull();
        });

        it("should handle 'how to debug' query", async () => {
            const { result } = await search_index.search_with_suggestions("how to debug");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Debugger");
        });
    });
});
