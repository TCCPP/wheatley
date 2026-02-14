import { describe, expect, it, beforeAll } from "vitest";
import * as fs from "fs";
import { globSync } from "glob";
import {
    parse_article,
    WIKI_ARTICLES_PATH,
    WIKI_STOP_WORDS,
    WikiArticle,
    WikiSearchIndex,
    create_wiki_search_entries,
} from "../src/modules/wheatley/components/wiki.js";
import { Index } from "../src/algorithm/search.js";
import { load_wiki_web_articles } from "../src/modules/wheatley/wiki-article-loader.js";

type WikiTestCase = {
    query: string;
    title?: string;
    title_contains?: string;
};

/* eslint-disable max-len */
const title_match_cases: WikiTestCase[] = [
    { query: "Undefined Behavior", title: "Undefined Behavior" },
    { query: "Address Sanitizer", title: "Address Sanitizer" },
    { query: "How to Learn C++ Programming", title: "How to Learn C++ Programming" },
    { query: "learn-cpp", title: "How to Learn C++ Programming" },
    { query: "learn-c", title: "How to Learn C Programming" },
    { query: "ub", title: "Undefined Behavior" },
    { query: "asan", title: "Address Sanitizer" },
    { query: "vla", title_contains: "VLA" },
    { query: "constexpr", title_contains: "constexpr" },
    { query: "xy", title_contains: "XY" },
    { query: "vampire", title_contains: "Vampire" },
    { query: "ask", title: "Just Post Your Question" },
    { query: "llm", title_contains: "Language Models" },
    { query: "boost", title: "Boost" },
    { query: "init", title_contains: "Initialization" },
    { query: "include", title: "Including headers" },
    { query: "vc", title: "Voice chat" },
    { query: "w3schools", title_contains: "W3Schools" },
    { query: "g4g", title_contains: "GeeksforGeeks" },
    { query: "save", title: "Save" },
    { query: "hw", title_contains: "Homework" },
    { query: "cp", title_contains: "Competitive" },
    { query: "sc", title_contains: "Screenshots" },
    { query: "UB", title: "Undefined Behavior" },
    { query: "VLA", title_contains: "VLA" },
    { query: "CONSTEXPR", title_contains: "constexpr" },
    { query: "undefined behavior", title: "Undefined Behavior" },
    { query: "UNDEFINED BEHAVIOR", title: "Undefined Behavior" },
    { query: "value categories", title: "Value Categories" },
    { query: "ERASE-REMOVE IDIOM", title: "Erase-Remove Idiom" },
];

const query_variation_cases: WikiTestCase[] = [
    { query: "learn", title_contains: "Learn" },
    { query: "learn c", title_contains: "Learn C" },
    { query: "learn cpp", title_contains: "Learn C++" },
    { query: "learn c++" },
    { query: "learn-c" },
    { query: "learn-cpp" },
    { query: "learncpp" },
    { query: "mingw", title_contains: "MinGW" },
    { query: "ide", title_contains: "IDE" },
    { query: "gdb" },
    { query: "cmake" },
    { query: "random", title_contains: "Random" },
    { query: "span", title_contains: "span" },
    { query: "ideas" },
    { query: "Undefined Behavio", title: "Undefined Behavior" },
    { query: "How to Learn C++ Programmin", title: "How to Learn C++ Programming" },
    { query: "How to Learn C Programmin", title: "How to Learn C Programming" },
    { query: "How to Learn C++ Programm", title: "How to Learn C++ Programming" },
    { query: "How to Format Code on Discor", title: "How to Format Code on Discord" },
    { query: "address san", title: "Address Sanitizer" },
    { query: "undefined", title: "Undefined Behavior" },
    { query: "sanitizer", title: "Address Sanitizer" },
    { query: "undefned", title: "Undefined Behavior" },
    { query: "sanitiser", title: "Address Sanitizer" },
    { query: "debbuger", title_contains: "Debug" },
    { query: "learn-c.md" },
    { query: "udnefined behavior", title: "Undefined Behavior" },
    { query: "virtul destructor", title_contains: "Virtual Destructor" },
    { query: "tempate instantiation", title_contains: "Template" },
    { query: "initializaton", title_contains: "Initialization" },
    { query: "forword declaration", title: "Forward Declarations" },
    { query: "How to Learn C++ Programming?", title: "How to Learn C++ Programming" },
    { query: "How to learn C++" },
    { query: "Learn C++ programming" },
    { query: "learn C programming", title_contains: "Learn C" },
    { query: "Learn C++" },
    { query: "learn cpp Programming" },
    { query: "How to Learn C Programming?", title: "How to Learn C Programming" },
    { query: "how to learn C++ Programming" },
];

const multi_word_and_content_cases: WikiTestCase[] = [
    { query: "smart pointer", title: "Smart Pointers in C++" },
    { query: "special member functions", title: "Special Member Functions in C++" },
    { query: "compiler warnings", title_contains: "Compiler Warnings" },
    { query: "operator precedence", title_contains: "Operator Precedence" },
    { query: "forward declarations", title: "Forward Declarations" },
    { query: "erase remove", title: "Erase-Remove Idiom" },
    { query: "class struct", title_contains: "class and struct" },
    { query: "template instantiation", title_contains: "Template Instantiation" },
    { query: "unsigned integers", title_contains: "Unsigned" },
    { query: "preprocessor macros", title_contains: "Preprocessor Macros" },
    { query: "global variables", title: "Global Variables in C++" },
    { query: "virtual destructor", title_contains: "Virtual Destructor" },
    { query: "pointer arithmetic", title_contains: "Pointer" },
    { query: "visual studio", title_contains: "Visual Studio" },
    { query: "format code discord" },
    { query: "scanf whitespace" },
    { query: "template argument deduction", title_contains: "Template Argument Deduction" },
    { query: "file types", title_contains: "File Types" },
    { query: "c declaration syntax", title_contains: "Declaration" },
    { query: "aggregate", title_contains: "Aggregate" },
    { query: "c vs c++" },
    { query: "naming variables", title_contains: "Name" },
    { query: "recursion", title_contains: "Recursion" },
    { query: "compilation steps" },
    { query: "ill-formed", title_contains: "Ill-Formed" },
    { query: "erroneous behavior", title_contains: "Erroneous" },
    { query: "using namespace std", title_contains: "using namespace std" },
    { query: "object oriented", title_contains: "Object-Oriented" },
    { query: "copy swap idiom" },
    { query: "overloading less than", title_contains: "Less Than" },
    { query: "how to debug" },
    { query: "stdc++" },
    { query: "std::array", title_contains: "std::array" },
    { query: "std::string_view", title_contains: "string_view" },
    { query: "std::span", title_contains: "span" },
    { query: "constexpr c" },
    { query: "what is undefined behavior", title: "Undefined Behavior" },
    { query: "why avoid unsigned", title_contains: "Unsigned" },
    { query: "how to use smart pointers", title: "Smart Pointers in C++" },
    { query: "when to use virtual destructor", title_contains: "Virtual Destructor" },
    { query: "difference between class and struct", title_contains: "class and struct" },
    { query: "why not using namespace std", title_contains: "using namespace std" },
    { query: "what are value categories", title: "Value Categories" },
    { query: "what is a vla", title_contains: "VLA" },
    { query: "how to enable warnings", title_contains: "Compiler Warnings" },
    { query: "what is constexpr", title_contains: "constexpr" },
    { query: "why avoid macros", title_contains: "Macros" },
    { query: "what is aggregate initialization", title_contains: "Aggregate" },
    { query: "how to overload operator", title_contains: "Overloading" },
    { query: "unique_ptr", title: "Smart Pointers in C++" },
    { query: "shared_ptr" },
    { query: "memory errors" },
];

const coverage_cases: WikiTestCase[] = [
    { query: "branchless", title_contains: "Branchless" },
    { query: "scoped enum", title_contains: "Enum" },
    { query: "casts in c++", title_contains: "casts" },
    { query: "ternary operator", title_contains: "Conditional Operator" },
    { query: "as-if rule", title_contains: "As-If Rule" },
    { query: "sequence points", title_contains: "Sequencing" },
    { query: "integer sizes", title_contains: "Sizes of Integers" },
    { query: "pi constant", title_contains: "Pi" },
    { query: "member initializer list", title_contains: "Member" },
    { query: "constraining templates", title_contains: "Constraining Templates" },
    { query: "templates header only", title_contains: "templates only be implemented in the header" },
    { query: "which initialization", title_contains: "Initialization" },
    { query: "compare and swap", title_contains: "Compare-And-Swap" },
    { query: "safer code", title_contains: "Safer" },
    { query: "format my code", title_contains: "Format" },
    { query: "overload assignment", title_contains: "Assignment Operator" },
    { query: "overload equality", title_contains: "Equality" },
    { query: "overload function call", title_contains: "Function Call" },
    { query: "overload arithmetic", title_contains: "Arithmetic" },
    { query: "perfect forwarding", title_contains: "Forwarding" },
    { query: "iterators", title_contains: "Iterator" },
    { query: "pointer basics", title_contains: "Pointer Basics" },
    { query: "c99 features", title_contains: "C99" },
    { query: "cin error", title_contains: "cin" },
    { query: "_BitInt", title_contains: "BitInt" },
    { query: "compilation", title_contains: "Compiled" },
    { query: "cheating", title_contains: "Cheat" },
    { query: "right channel", title_contains: "Right Channel" },
    { query: "how to ask a question", title_contains: "Ask" },
    { query: "strict weak ordering", title_contains: "Strict Weak" },
    { query: "floating point", title_contains: "Floating Point" },
    { query: "ownership", title: "Ownership" },
    { query: "std::endl", title_contains: "endl" },
    { query: "stream operators", title_contains: "Stream Operators" },
    { query: "c++ standards", title_contains: "Standards" },
    { query: "c++ libraries", title_contains: "Libraries" },
    { query: "performance analysis", title_contains: "Performance" },
    { query: "pointer" },
    { query: "compiler" },
    { query: "memory leak" },
];

const edge_case_queries = [
    "c",
    "o",
    "д",
    "@everyone",
    "this is a very long query that probably won't match anything specific",
    "how can i write c++ code in ios device",
    "do hello world in c++",
    "core an apple",
    "c++",
    "c99",
    "stepping through",
    "beginner",
];
/* eslint-enable max-len */

describe("wiki search system", () => {
    let search_index: WikiSearchIndex;

    beforeAll(async () => {
        const articles: Record<string, WikiArticle> = {};
        const article_aliases = new Map<string, string>();

        // Load bot articles from the bot-articles directory
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

        // Load wiki web articles (from wiki/wiki/) to match production behavior
        const existing_titles = new Set(Object.values(articles).map(a => a.title));
        for (const wiki_article of await load_wiki_web_articles()) {
            try {
                const [article, aliases] = parse_article(wiki_article.path, wiki_article.bot_article, str => str);
                if (existing_titles.has(article.title)) {
                    continue;
                }
                existing_titles.add(article.title);
                article.wikilink = wiki_article.url;
                article.wiki_page_title = wiki_article.page_title;
                articles[wiki_article.path] = article;
                const frontmatter_aliases = Array.isArray(wiki_article.alias)
                    ? wiki_article.alias
                    : wiki_article.alias
                      ? [wiki_article.alias]
                      : [];
                for (const alias of [...aliases, ...frontmatter_aliases]) {
                    article_aliases.set(alias, wiki_article.path);
                }
            } catch (e) {
                console.error(`Failed to parse wiki article ${wiki_article.path}:`, e);
            }
        }

        const search_entries = create_wiki_search_entries(articles, article_aliases);
        search_index = new Index(search_entries, (title: string) => [title.toLowerCase()], {
            embedding_key_extractor: entry => entry.article.name ?? undefined,
            embedding_bonus: 1.0,
            stop_words: WIKI_STOP_WORDS,
        });
        await search_index.load_embeddings("indexes/wiki/embeddings.json");
    }, 120_000);

    function run_wiki_test_cases(cases: WikiTestCase[], section_name: string) {
        describe(section_name, () => {
            for (const test_case of cases) {
                it(`'${test_case.query}'`, async () => {
                    const { result } = await search_index.search_with_suggestions(test_case.query);
                    expect(result).not.toBeNull();
                    if (test_case.title) {
                        expect(result?.title).toBe(test_case.title);
                    }
                    if (test_case.title_contains) {
                        expect(result?.title).toContain(test_case.title_contains);
                    }
                });
            }
        });
    }

    run_wiki_test_cases(title_match_cases, "title matching");
    run_wiki_test_cases(query_variation_cases, "query variations");
    run_wiki_test_cases(multi_word_and_content_cases, "multi-word and content queries");
    run_wiki_test_cases(coverage_cases, "article coverage");

    describe("edge cases", () => {
        for (const query of edge_case_queries) {
            it(`'${query}'`, async () => {
                await search_index.search_with_suggestions(query);
            });
        }

        it("empty query returns null", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("");
            expect(result).toBeNull();
            expect(suggestions).toEqual([]);
        });
    });

    describe("multi-word and conceptual queries", () => {
        it("'how to ask' -> an asking article", async () => {
            const { result } = await search_index.search_with_suggestions("how to ask");
            expect(result).not.toBeNull();
            expect(
                result?.title === "Just Post Your Question" ||
                    result?.title === "How to Ask for Programming Help" ||
                    result?.title === "How to Ask a Programming Question",
            ).toBe(true);
        });
    });

    describe("search ranking", () => {
        it("'ub' should rank Undefined Behavior first", async () => {
            const results = await search_index.search_get_top_5_async("ub");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toBe("Undefined Behavior");
        });

        it("'smart pointer' should rank Smart Pointers first", async () => {
            const results = await search_index.search_get_top_5_async("smart pointer");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toBe("Smart Pointers in C++");
        });

        it("'virtual destructor' should rank correctly", async () => {
            const results = await search_index.search_get_top_5_async("virtual destructor");
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].title).toContain("Virtual Destructor");
        });
    });

    describe("suggestions", () => {
        it("broad query 'pointers' returns result and bounded suggestions", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("pointers");
            expect(result).not.toBeNull();
            expect(suggestions.length).toBeGreaterThanOrEqual(0);
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });

        it("'ub' returns correct result with bounded suggestions", async () => {
            const { result, suggestions } = await search_index.search_with_suggestions("ub");
            expect(result).not.toBeNull();
            expect(result?.title).toBe("Undefined Behavior");
            expect(suggestions.length).toBeGreaterThanOrEqual(0);
        });

        it("suggestions are always capped at 3", async () => {
            const { suggestions } = await search_index.search_with_suggestions("c");
            expect(suggestions.length).toBeLessThanOrEqual(3);
        });
    });
});
