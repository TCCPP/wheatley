import { describe, expect, it } from "vitest";

import { split_message_markdown_aware } from "../src/utils/discord.js";

describe("split_message_markdown_aware", () => {
    it("should not split short messages", () => {
        expect(split_message_markdown_aware("Hello, World")).toEqual(["Hello, World"]);
        expect(split_message_markdown_aware("A".repeat(2000))).toEqual(["A".repeat(2000)]);
    });

    it("should split long plain text", () => {
        const long_text = "A".repeat(3000);
        const chunks = split_message_markdown_aware(long_text);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBeLessThanOrEqual(2000);
        expect(chunks[1].length).toBeLessThanOrEqual(2000);
        expect(chunks.join("")).toBe(long_text);
    });

    it("should preserve inline formatting", () => {
        const text = "*italic* **bold** __underline__ ~~strikethrough~~ ||spoiler||";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve inline code", () => {
        const text = "Some `inline code` here";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve links", () => {
        const text = "Check out [this link](https://example.com)";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve headers", () => {
        const text = "# Header 1\n## Header 2\n### Header 3";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve blockquotes", () => {
        const text = "> This is a quote\n> Multi-line quote";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve subtext", () => {
        const text = "-# This is subtext";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve lists", () => {
        const text = "- Item 1\n- Item 2\n- Item 3";
        expect(split_message_markdown_aware(text)).toEqual([text]);

        const numbered = "1. First\n2. Second\n3. Third";
        expect(split_message_markdown_aware(numbered)).toEqual([numbered]);
    });

    it("should handle simple code blocks", () => {
        const text = "```cpp\nint main() {\n    return 0;\n}\n```";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should split code blocks on line boundaries", () => {
        const lines = Array(100)
            .fill(0)
            .map((_, i) => `Line ${i} with some additional content to make it longer`);
        const code_block = "```js\n" + lines.join("\n") + "\n```";
        const chunks = split_message_markdown_aware(code_block);

        expect(chunks.length).toBeGreaterThan(1);

        // First chunk should end with closing ```
        expect(chunks[0].trim().endsWith("```")).toBe(true);

        // Middle chunks should start with opening ``` and end with closing ```
        for (let i = 1; i < chunks.length - 1; i++) {
            expect(chunks[i].trim().startsWith("```")).toBe(true);
            expect(chunks[i].trim().endsWith("```")).toBe(true);
        }

        // Last chunk should start with opening ```
        expect(chunks[chunks.length - 1].trim().startsWith("```")).toBe(true);
    });

    it("should preserve language tags when splitting code blocks", () => {
        const lines = Array(150)
            .fill(0)
            .map((_, i) => `console.log("This is a longer line number ${i}");`);
        const code_block = "```typescript\n" + lines.join("\n") + "\n```";
        const chunks = split_message_markdown_aware(code_block);

        expect(chunks.length).toBeGreaterThan(1);

        // Each chunk should have the language tag
        for (const chunk of chunks) {
            if (chunk.includes("```")) {
                // Check that language tag appears after opening ```
                const match = chunk.match(/```(\w+)?/);
                if (match && chunk.indexOf(match[0]) < 10) {
                    // Only check opening tags (near start of chunk)
                    expect(match[1]).toBe("typescript");
                }
            }
        }
    });

    it("should handle code blocks without language tags", () => {
        const lines = Array(50)
            .fill(0)
            .map((_, i) => `line ${i}`);
        const code_block = "```\n" + lines.join("\n") + "\n```";
        const chunks = split_message_markdown_aware(code_block);

        // Should split if content is long enough
        if (code_block.length > 2000) {
            expect(chunks.length).toBeGreaterThan(1);
        }

        // All chunks should be valid
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(2000);
        }
    });

    it("should handle mixed content with code and text", () => {
        const text =
            "Here's some code:\n```python\n" +
            Array(50)
                .fill(0)
                .map((_, i) => `print(${i})`)
                .join("\n") +
            "\n```\nAnd some more text after.";

        const chunks = split_message_markdown_aware(text);

        // Verify all content is preserved
        expect(chunks.join("")).toBe(text);

        // All chunks should be within limit
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(2000);
        }
    });

    it("should handle consecutive code blocks", () => {
        const text = "```js\nconsole.log('first');\n```\n" + "Some text\n" + "```js\nconsole.log('second');\n```";

        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should handle nested formatting", () => {
        const text = "***bold and italic*** with __underline__ and ~~strikethrough~~";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should handle empty strings", () => {
        expect(split_message_markdown_aware("")).toEqual([""]);
    });

    it("should handle exactly 2000 characters", () => {
        const text = "A".repeat(2000);
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should split at 2001 characters", () => {
        const text = "A".repeat(2001);
        const chunks = split_message_markdown_aware(text);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBeLessThanOrEqual(2000);
        expect(chunks[1].length).toBeLessThanOrEqual(2000);
    });

    it("should handle very long code blocks", () => {
        const lines = Array(200)
            .fill(0)
            .map((_, i) => `function_${i}();`);
        const code_block = "```cpp\n" + lines.join("\n") + "\n```";
        const chunks = split_message_markdown_aware(code_block);

        expect(chunks.length).toBeGreaterThan(1);

        // Verify all chunks are within limit
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(2000);
        }

        // Verify content is preserved (accounting for added ``` delimiters)
        const reconstructed = chunks
            .map(chunk => {
                // Remove markdown delimiters for comparison
                return chunk
                    .replace(/^```\w*\n/, "")
                    .replace(/\n```$/, "")
                    .trim();
            })
            .join("\n");

        const original_content = code_block
            .replace(/^```\w*\n/, "")
            .replace(/\n```$/, "")
            .trim();

        // Content should match (may have extra newlines from splitting)
        expect(reconstructed.replace(/\n+/g, "\n")).toBe(original_content.replace(/\n+/g, "\n"));
    });

    it("should respect custom limit parameter", () => {
        const text = "A".repeat(150);
        const chunks = split_message_markdown_aware(text, 100);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBeLessThanOrEqual(100);
        expect(chunks[1].length).toBeLessThanOrEqual(100);
    });

    it("should handle mixed lists", () => {
        const text = "1. test\n- abba\n- foobar";
        expect(split_message_markdown_aware(text)).toEqual(["1. test\n- abba\n- foobar"]);
    });

    it("should handle splitting general text", () => {
        const text = "foo bar baz biz buzzzz boz bez";
        expect(split_message_markdown_aware(text, 20)).toEqual(["foo bar baz biz", "buzzzz boz bez"]);
    });

    it("should handle splitting general formatters", () => {
        const text = "*foo bar baz biz buzzzz boz bez*";
        expect(split_message_markdown_aware(text, 20)).toEqual(["*foo bar baz biz*", "*buzzzz boz bez*"]);
    });

    it("should avoid splitting block items", () => {
        let chunks = split_message_markdown_aware("foo bar baz > biz buzzzz boz bez", 20);
        expect(chunks).to.deep.equal(["foo bar baz", "> biz buzzzz boz bez"]);
        chunks = split_message_markdown_aware("foo bar baz # biz buzzzz boz bez", 20);
        expect(chunks).to.deep.equal(["foo bar baz", "# biz buzzzz boz bez"]);
        chunks = split_message_markdown_aware("foo bar baz -# biz buzzzz boz bez", 20);
        expect(chunks).to.deep.equal(["foo bar baz", "-# biz buzzzz boz", "-# bez"]);
    });

    it("should split block items correctly", () => {
        const chunks = split_message_markdown_aware("> foo bar baz biz buzzzz boz bez", 20);
        expect(chunks).to.deep.equal(["> foo bar baz biz", "> buzzzz boz bez"]);
    });

    it("not split nested lists", () => {
        const chunks = split_message_markdown_aware("- foo\n- bar\n- baz\n  - biz", 20);
        expect(chunks).to.deep.equal(["- foo\n- bar\n", "- baz\n  - biz"]);
    });

    it("not split in the middle of a list bullet", () => {
        const chunks = split_message_markdown_aware("- test\n- foo\n- foo bar baz", 20);
        expect(chunks).to.deep.equal(["- test\n- foo\n", "- foo bar baz"]);
    });

    it("should handle deeply nested lists", () => {
        const text = "- foo\n  - bar\n    - baz\n      - deep";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should preserve indentation in nested numbered lists", () => {
        const text = "1. first\n2. second\n   1. nested one\n   2. nested two\n3. third";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should handle mixed nested and non-nested list items", () => {
        const text = "- item1\n- item2\n  - nested\n- item3";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should split long nested lists correctly", () => {
        const text = "- " + "a".repeat(15) + "\n- " + "b".repeat(15) + "\n  - " + "c".repeat(15);
        const chunks = split_message_markdown_aware(text, 40);
        expect(chunks.length).toBeGreaterThan(1);
        const rejoined = chunks.join("");
        expect(rejoined).toContain("  - ");
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(40);
        }
    });

    it("should handle nested lists with multiple items", () => {
        const text = "- parent1\n  - child1\n  - child2\n  - child3\n- parent2";
        expect(split_message_markdown_aware(text)).toEqual([text]);
    });

    it("should prefer splitting on newlines instead of spaces", () => {
        const text = "This is a long line of text that goes on and on\nAnd this is another line that continues";
        const chunks = split_message_markdown_aware(text, 50);
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe("This is a long line of text that goes on and on");
        expect(chunks[1]).toBe("And this is another line that continues");
    });

    it("should prefer splitting on newlines with multiple newlines", () => {
        const text = "Line 1 has some text\nLine 2 has more text\nLine 3 has even more text\nLine 4 continues";
        const chunks = split_message_markdown_aware(text, 45);
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe("Line 1 has some text\nLine 2 has more text");
        expect(chunks[1]).toBe("Line 3 has even more text\nLine 4 continues");
    });

    it("should prefer splitting on newlines", () => {
        const text = "This is a somewhat long paragraph\nthat contains multiple lines";
        const chunks = split_message_markdown_aware(text, 50);
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe("This is a somewhat long paragraph");
        expect(chunks[1]).toBe("that contains multiple lines");
    });

    it("should fall back to space splitting when no newlines available", () => {
        const text = "This is a very long single line without any newlines that needs to be split somewhere";
        const chunks = split_message_markdown_aware(text, 50);
        expect(chunks.length).toBe(2);
        // Should split on a space since no newlines are available
        expect(chunks[0]).not.toContain("\n");
        expect(chunks[1]).not.toContain("\n");
    });

    it("should handle text with newlines at the boundary", () => {
        const text = "A".repeat(20) + "\n" + "B".repeat(20);
        const chunks = split_message_markdown_aware(text, 21);
        expect(chunks.length).toBe(2);
        expect(chunks[0]).toBe("A".repeat(20));
        expect(chunks[1]).toBe("B".repeat(20));
    });
});
