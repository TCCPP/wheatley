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
});
