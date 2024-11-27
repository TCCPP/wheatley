import { describe, expect, it } from "vitest";

import { MarkdownParser } from "../src/utils/markdown.js";

describe("Markdown tests", () => {
    it("should handle plain text", () => {
        expect.soft(MarkdownParser.parse("foo bar")).to.deep.equal({
            content: [
                {
                    content: "foo bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle bold", () => {
        expect.soft(MarkdownParser.parse("foo **bar**")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo **bar** baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ** bar ** baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: " bar ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle underline", () => {
        expect.soft(MarkdownParser.parse("foo __bar__")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "__",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo __bar__ baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "__",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo __ bar __ baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: " bar ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "__",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle strikethrough", () => {
        expect.soft(MarkdownParser.parse("foo ~~bar~~")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "~~",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ~~bar~~ baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "~~",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ~~ bar ~~ baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: " bar ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "~~",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle spoiler", () => {
        expect.soft(MarkdownParser.parse("foo ||bar||")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "||",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ||bar|| baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "||",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo || bar || baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: " bar ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "||",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle italics", () => {
        expect.soft(MarkdownParser.parse("foo *bar*")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo _bar_")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo *bar* baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo *bar* baz *boz*")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
                {
                    content: " baz ",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "boz",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo * bar * baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "* bar ",
                    type: "plain",
                },
                {
                    content: "* baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle escapes", () => {
        expect.soft(MarkdownParser.parse("foo \\*bar\\*")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo \\**bar\\**")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "*bar",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle newlines", () => {
        expect.soft(MarkdownParser.parse("foo\nbar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\nbar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\\\nbar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\\",
                    type: "plain",
                },
                {
                    content: "\nbar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**foo\nbar**")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\nbar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
    });
    it("should handle combined text formatters", () => {
        expect.soft(MarkdownParser.parse("***foo***")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                formatter: "*",
                                type: "format",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("***__foo__***")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: {
                                                content: [
                                                    {
                                                        content: "foo",
                                                        type: "plain",
                                                    },
                                                ],
                                                type: "doc",
                                            },
                                            formatter: "__",
                                            type: "format",
                                        },
                                    ],
                                    type: "doc",
                                },
                                formatter: "*",
                                type: "format",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
    });
    it("should handle text formatting edge cases", () => {
        expect.soft(MarkdownParser.parse("**foo***")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "*",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**foo*")).to.deep.equal({
            content: [
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**foo__bar**baz__")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "_",
                                type: "plain",
                            },
                            {
                                content: "_bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: "baz",
                    type: "plain",
                },
                {
                    content: "_",
                    type: "plain",
                },
                {
                    content: "_",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("** **")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: " ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**")).to.deep.equal({
            content: [
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("***")).to.deep.equal({
            content: [
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("****")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "*",
                                type: "plain",
                            },
                            {
                                content: "*",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*****")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "*",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        // TODO: Double check
        expect.soft(MarkdownParser.parse("******")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "*",
                                type: "plain",
                            },
                            {
                                content: "*",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        // TODO: Double check
        expect.soft(MarkdownParser.parse("*******")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "*",
                                type: "plain",
                            },
                            {
                                content: "*",
                                type: "plain",
                            },
                            {
                                content: "*",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("||")).to.deep.equal({
            content: [
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("|||")).to.deep.equal({
            content: [
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("||||")).to.deep.equal({
            content: [
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
                {
                    content: "|",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("||||||")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "|",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "||",
                    type: "format",
                },
                {
                    content: "|",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("~~~~")).to.deep.equal({
            content: [
                {
                    content: "~",
                    type: "plain",
                },
                {
                    content: "~",
                    type: "plain",
                },
                {
                    content: "~",
                    type: "plain",
                },
                {
                    content: "~",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("~~~~~")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "~",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "~~",
                    type: "format",
                },
            ],
            type: "doc",
        });
    });
    it("should handle inline code", () => {
        expect.soft(MarkdownParser.parse("foo `bar` baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar",
                    type: "inline code",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo `bar` baz `biz`")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar",
                    type: "inline code",
                },
                {
                    content: " baz ",
                    type: "plain",
                },
                {
                    content: "biz",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ``bar`` baz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar",
                    type: "inline code",
                },
                {
                    content: " baz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ``bar`` baz ``biz``")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar",
                    type: "inline code",
                },
                {
                    content: " baz ",
                    type: "plain",
                },
                {
                    content: "biz",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo `bar\nbaz` boz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar\nbaz",
                    type: "inline code",
                },
                {
                    content: " boz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ``bar`baz`` boz")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar`baz",
                    type: "inline code",
                },
                {
                    content: " boz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo ``bar`baz`` boz ``bar`baz``")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "bar`baz",
                    type: "inline code",
                },
                {
                    content: " boz ",
                    type: "plain",
                },
                {
                    content: "bar`baz",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
    });
    it("should handle code blocks", () => {
        expect.soft(MarkdownParser.parse("```foo```")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("``` foo ```")).to.deep.equal({
            content: [
                {
                    content: " foo ",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```foo bar```")).to.deep.equal({
            content: [
                {
                    content: "foo bar",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```cpp\nfoo```")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    language: "cpp",
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```cpp\nfoo\n```")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    language: "cpp",
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```cpp foo\nbar```")).to.deep.equal({
            content: [
                {
                    content: "cpp foo\nbar",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo```cpp\nbar```")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "bar",
                    language: "cpp",
                    type: "code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo```cpp\nbar```bar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "bar",
                    language: "cpp",
                    type: "code",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo```cpp\nbar``` bar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "bar",
                    language: "cpp",
                    type: "code",
                },
                {
                    content: " bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo```cpp\nbar```\nbar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "bar",
                    language: "cpp",
                    type: "code",
                },
                {
                    content: "\nbar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```cpp\n```")).to.deep.equal({
            content: [
                {
                    content: "cpp",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
    });
    it("should handle formatters running into code blocks", () => {
        expect.soft(MarkdownParser.parse("*foo```bar*baz```")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
                {
                    content: "baz",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo```bar*baz```biz*")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "bar*baz",
                    language: null,
                    type: "code",
                },
                {
                    content: "biz",
                    type: "plain",
                },
                {
                    content: "*",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle code block edge cases", () => {
        expect.soft(MarkdownParser.parse("`")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("``")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("````")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("`````")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("``````")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("```````")).to.deep.equal({
            content: [
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("``` ``")).to.deep.equal({
            content: [
                {
                    content: "` ",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("``` ```")).to.deep.equal({
            content: [
                {
                    content: " ",
                    language: null,
                    type: "code",
                },
            ],
            type: "doc",
        });
    });
    it("should handle blockquotes", () => {
        expect.soft(MarkdownParser.parse("> foo bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("> foo\nbar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("> foo\n> bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo > bar")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "> bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse(">foo")).to.deep.equal({
            content: [
                {
                    content: ">foo",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse(">  foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: " foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n  > foo")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n  ", // TODO: Reconsider
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n> bar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("> > foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "> foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
            ],
            type: "doc",
        });
    });
    it("should handle mixing blockquotes and other crap", () => {
        expect.soft(MarkdownParser.parse("*> foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "blockquote",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("** > foo **")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo ",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "blockquote",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("> `foo\nbar`")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("> ```foo\nbar```")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n", // TODO: Get rid of the trailing \n here
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "blockquote",
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n>foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: ">foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n> foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "blockquote",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("`test\n> foo`")).to.deep.equal({
            content: [
                {
                    content: "test\n> foo",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**test\n> foo**bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "blockquote",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle subtext", () => {
        expect.soft(MarkdownParser.parse("-# foo bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-# foo\nbar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-# foo\n-# bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo -# bar")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "-",
                    type: "plain",
                },
                {
                    content: "# bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-#foo")).to.deep.equal({
            content: [
                {
                    content: "-",
                    type: "plain",
                },
                {
                    content: "#foo",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-#  foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n  -# foo")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n  ", // TODO: Reconsider
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n-# bar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-#")).to.deep.equal({
            content: [
                {
                    content: "-",
                    type: "plain",
                },
                {
                    content: "#",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-# -# foo")).to.deep.equal({
            content: [
                {
                    content: "-",
                    type: "plain",
                },
                {
                    content: "# ",
                    type: "plain",
                },
                {
                    content: "-",
                    type: "plain",
                },
                {
                    content: "# foo",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-#  -# foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "subtext",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
            ],
            type: "doc",
        });
    });
    it("should handle mixing subtext and other crap", () => {
        expect.soft(MarkdownParser.parse("*-# foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "subtext",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        // TODO: FIXME
        // expect.soft(MarkdownParser.parse("** -# foo **")).to.deep.equal({
        //     content: [
        //         {
        //             content: {
        //                 content: [
        //                     {
        //                         content: " -# foo ",
        //                         type: "plain",
        //                     },
        //                 ],
        //                 type: "doc",
        //             },
        //             formatter: "**",
        //             type: "format",
        //         },
        //     ],
        //     type: "doc",
        // });
        expect.soft(MarkdownParser.parse("-# `foo\nbar`")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("-# ```foo\nbar```")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n", // TODO: Get rid of the trailing \n here
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "subtext",
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n-#foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: "-",
                                type: "plain",
                            },
                            {
                                content: "#foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n-# foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "subtext",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("`test\n-# foo`")).to.deep.equal({
            content: [
                {
                    content: "test\n-# foo",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**test\n-# foo**bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "subtext",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle headers", () => {
        expect.soft(MarkdownParser.parse("# foo bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("## foo bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 2,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("### foo bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 3,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("#### foo bar")).to.deep.equal({
            content: [
                {
                    content: "#",
                    type: "plain",
                },
                {
                    content: "#",
                    type: "plain",
                },
                {
                    content: "#",
                    type: "plain",
                },
                {
                    content: "# foo bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("# foo\nbar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("# foo\n# bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo # bar")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "# bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("#foo")).to.deep.equal({
            content: [
                {
                    content: "#foo",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("#  foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n  # foo")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n  ", // TODO: Reconsider
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("foo\n# bar")).to.deep.equal({
            content: [
                {
                    content: "foo",
                    type: "plain",
                },
                {
                    content: "\n",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("#")).to.deep.equal({
            content: [
                {
                    content: "#",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("# # foo")).to.deep.equal({
            content: [
                {
                    content: "# ",
                    type: "plain",
                },
                {
                    content: "# foo",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("#  # foo")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "header",
                                level: 1,
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
            ],
            type: "doc",
        });
    });
    it("should handle mixing headers and other crap", () => {
        expect.soft(MarkdownParser.parse("*# foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "header",
                                level: 1,
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        // TODO: FIXME
        // expect.soft(MarkdownParser.parse("** # foo **")).to.deep.equal({
        //     content: [
        //         {
        //             content: {
        //                 content: [
        //                     {
        //                         content: " # foo ",
        //                         type: "plain",
        //                     },
        //                 ],
        //                 type: "doc",
        //             },
        //             formatter: "**",
        //             type: "format",
        //         },
        //     ],
        //     type: "doc",
        // });
        expect.soft(MarkdownParser.parse("# `foo\nbar`")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("# ```foo\nbar```")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`",
                                type: "plain",
                            },
                            {
                                content: "`foo",
                                type: "plain",
                            },
                            {
                                content: "\n", // TODO: Get rid of the trailing \n here
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    type: "header",
                    level: 1,
                },
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
                {
                    content: "`",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n#foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: "#foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("*test\n# foo*")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "header",
                                level: 1,
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "*",
                    type: "format",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("`test\n# foo`")).to.deep.equal({
            content: [
                {
                    content: "test\n# foo",
                    type: "inline code",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("**test\n# foo**bar")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "test",
                                type: "plain",
                            },
                            {
                                content: "\n",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "foo",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                type: "header",
                                level: 1,
                            },
                        ],
                        type: "doc",
                    },
                    formatter: "**",
                    type: "format",
                },
                {
                    content: "bar",
                    type: "plain",
                },
            ],
            type: "doc",
        });
    });
    it("should handle headers", () => {
        expect.soft(MarkdownParser.parse("foo [ asfd ](asdf)")).to.deep.equal({
            content: [
                {
                    content: "foo ",
                    type: "plain",
                },
                {
                    content: "[ asfd ",
                    type: "plain",
                },
                {
                    content: "]",
                    type: "plain",
                },
                {
                    content: "(asdf",
                    type: "plain",
                },
                {
                    content: ")",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("bar[foo](https://google.com)barz")).to.deep.equal({
            content: [
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    target: "https://google.com",
                    type: "masked link",
                },
                {
                    content: "barz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("bar[foo\\]bar](https://google.com/\\)bar)barz")).to.deep.equal({
            content: [
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "]",
                                type: "plain",
                            },
                            {
                                content: "bar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    target: "https://google.com/\\)bar",
                    type: "masked link",
                },
                {
                    content: "barz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("bar[ foobar ]( https://google.com/bar )barz")).to.deep.equal({
            content: [
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: {
                        content: [
                            {
                                content: " foobar ",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    target: " https://google.com/bar ",
                    type: "masked link",
                },
                {
                    content: "barz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("bar[foobar](ftp://google.com/bar)barz")).to.deep.equal({
            content: [
                {
                    content: "bar",
                    type: "plain",
                },
                {
                    content: "[foobar",
                    type: "plain",
                },
                {
                    content: "]",
                    type: "plain",
                },
                {
                    content: "(",
                    type: "plain",
                },
                {
                    content: "f",
                    type: "plain",
                },
                {
                    content: "t",
                    type: "plain",
                },
                {
                    content: "p",
                    type: "plain",
                },
                {
                    content: ":",
                    type: "plain",
                },
                {
                    content: "/",
                    type: "plain",
                },
                {
                    content: "/google",
                    type: "plain",
                },
                {
                    content: ".com",
                    type: "plain",
                },
                {
                    content: "/bar",
                    type: "plain",
                },
                {
                    content: ")barz",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("[foo**bar**](https://google.com)")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: {
                                    content: [
                                        {
                                            content: "bar",
                                            type: "plain",
                                        },
                                    ],
                                    type: "doc",
                                },
                                formatter: "**",
                                type: "format",
                            },
                        ],
                        type: "doc",
                    },
                    target: "https://google.com",
                    type: "masked link",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("[foo](https://\ngoogle.com)")).to.deep.equal({
            content: [
                {
                    content: "[foo",
                    type: "plain",
                },
                {
                    content: "]",
                    type: "plain",
                },
                {
                    content: "(",
                    type: "plain",
                },
                {
                    content: "h",
                    type: "plain",
                },
                {
                    content: "t",
                    type: "plain",
                },
                {
                    content: "t",
                    type: "plain",
                },
                {
                    content: "p",
                    type: "plain",
                },
                {
                    content: "s",
                    type: "plain",
                },
                {
                    content: ":",
                    type: "plain",
                },
                {
                    content: "/",
                    type: "plain",
                },
                {
                    content: "/",
                    type: "plain",
                },
                {
                    content: "\ngoogle",
                    type: "plain",
                },
                {
                    content: ".com",
                    type: "plain",
                },
                {
                    content: ")",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("[foo\nbar](https://google.com)")).to.deep.equal({
            content: [
                {
                    content: {
                        content: [
                            {
                                content: "foo",
                                type: "plain",
                            },
                            {
                                content: "\nbar",
                                type: "plain",
                            },
                        ],
                        type: "doc",
                    },
                    target: "https://google.com",
                    type: "masked link",
                },
            ],
            type: "doc",
        });
        expect.soft(MarkdownParser.parse("[foo] (https://google.com)")).to.deep.equal({
            content: [
                {
                    content: "[foo",
                    type: "plain",
                },
                {
                    content: "] ",
                    type: "plain",
                },
                {
                    content: "(",
                    type: "plain",
                },
                {
                    content: "h",
                    type: "plain",
                },
                {
                    content: "t",
                    type: "plain",
                },
                {
                    content: "t",
                    type: "plain",
                },
                {
                    content: "p",
                    type: "plain",
                },
                {
                    content: "s",
                    type: "plain",
                },
                {
                    content: ":",
                    type: "plain",
                },
                {
                    content: "/",
                    type: "plain",
                },
                {
                    content: "/google",
                    type: "plain",
                },
                {
                    content: ".com",
                    type: "plain",
                },
                {
                    content: ")",
                    type: "plain",
                },
            ],
            type: "doc",
        });
        // TODO
        // expect.soft(MarkdownParser.parse("[foo[foo](https://google.com)](https://google.com)")).to.deep.equal(0);
    });
});

// ```test```> foo
// `test
// `> foo

// __foo
// # bar__ baz
