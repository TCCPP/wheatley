import { strict as assert } from "assert";
import { document_fragment, list, markdown_node } from "./markdown_nodes.js";

// References:
// https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline
// eslint-disable-next-line max-len
// https://github.com/discord/SimpleAST/blob/master/simpleast-core/src/main/java/com/discord/simpleast/core/simple/SimpleMarkdownRules.kt

// Rules:
// Italics: * or _
// Bold: **
// Underline: __
// Strikethrough: ~~
// Spoiler: ||
// Inline code: `text` or ``text``
// Header: # / ## / ### followed by a space and not immediately followed by a #, e.g. # # foo doesn't match
// Subtext: -# followed by a space and not immediately followed by -#, e.g. -# -# foo doesn't match
// Masked links [markdown](link), escapes are observed in the link
// Lists: - or * for an unordered bullet, 1. etc for a numbered bullet, two spaces for subsequent bullet indentation
// Code blocks:
// Blockquotes: > followed by a space at the start of the line, block quotes don't nest but you can put block quotes in
// other elements like list items or headers

// Discord markdown doesn't differentiate inline elements and block elements, for something like the following italics
// are matched before the code block:
//   *foo
//   ```
//   bar*
//   ```
// As another example, in the following the underlining applies to everything including the code block contents
//   __foo
//   ```bar```
//   baz__

// Some other edge cases:
// "# # foo" isn't a header, it only matches as text
// "# > # foo" matches both #'s but "# > # > # > foo" doesn't match beyond the starting "# > #"
// blockquotes appear to be one of the only things that can't nest, so # > # > foo doesn't nest but anything else can,
// e.g. this is valid up to 11 levels of list items:
//  - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# - -# foo
// and this is valid arbitrarily:
// eslint-disable-next-line max-len
// -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # -# # foo
// Masked links also appear to prevent nesting
// ````foo```` renders as a code block with the content "`foo" and then a ` at the end of the code block
// foo * a * bar doesn't do italics (foo * a *bar doesn't either, foo *a * bar does)
// foo ** a ** bar does do bold, similar with all other formatters
// **foo__**bar__ renders as a bold "foo__" then "bar__"; **foo*** renders as a bold "foo*"
// The following:
//   **foo
//   > bar** baz
// renders as bold "foo", blockquote bold "bar", then "baz" on a new line, similarly for other block elements
// *** renders as "***", **** renders as an italic "**", ***** renders as a bold "*"
// - > - foo renders as a list item with a block quote and then a nested bullet
// # - > - ``` foo ``` is a thing that works
// *> foo* parses as an italicized blockquote
// This matches as a list item with a blockquote then foo on a different line outside the list/quote
//   - >>> foo
//   foo

// regexes based on discord/SimpleAST, which is Copyright [2018] [Discord] under the apache v2 license
const BOLD_RE = /^\*\*([\s\S]+?)\*\*(?!\*)/;
const UNDERLINE_RE = /^__([\s\S]+?)__(?!_)/;
const STRIKETHROUGH_RE = /^~~([\s\S]+?)~~/; // new RegExp("^~~(?=\\S)([\\s\\S]*?\\S)~~");
const SPOILER_RE = /^\|\|([\s\S]+?)\|\|/;
// const NEWLINE_RE = new RegExp("^(?:\\n *)*\\n");
const TEXT_RE = /^[\s\S]+?(?=[^0-9A-Za-z\s\u00c0-\uffff]|\n| {2,}\n|\w+:\S|$)/;
const ESCAPE_RE = /^\\([^0-9A-Za-z\s])/;
const ITALICS_RE = new RegExp(
    // only match _s surrounding words.
    "^\\b_" +
        "((?:__|\\\\[\\s\\S]|[^\\\\_])+?)_" +
        "\\b" +
        "|" +
        // Or match *s that are followed by a non-space:
        "^\\*(?=\\S)(" +
        // Match any of:
        //  - `**`: so that bolds inside italics don't close the
        // italics
        //  - whitespace
        //  - non-whitespace, non-* characters
        "(?:\\*\\*|\\s+(?:[^*\\s]|\\*\\*)|[^\\s*])+?" +
        // followed by a non-space, non-* then *
        ")\\*(?!\\*)",
);
const CODE_BLOCK_RE = /^```(?:([\w+\-.]+?)?(\s*\n))?([^\n].*?)\n*```/s;
const INLINE_CODE_RE = /^(``?)(.*?)\1/s; // new RegExp("^(``?)([^`]*)\\1", "s");
// eslint-disable-next-line max-len
const BLOCKQUOTE_RE = /^(?: *>>> (.+)| *>(?!>>) ([^\n]+\n?))/s; // new RegExp("^(?: *>>> ?(.+)| *>(?!>>) ?([^\\n]+\\n?))", "s");
const SUBTEXT_RE = /^-# (?!-#) *([^\n]+\n?)/;
const HEADER_RE = /^(#{1,3}) (?!#) *([^\n]+\n?)/;
// eslint-disable-next-line max-len
// const LINK_RE = /^\[((?:\\.|[^\]\\])*)\]\((\s*https:\/\/.*?(?:\\.|[^)\\\n])*)\)(?!\]\((\s*https:\/\/.*?(?:\\.|[^)\\\n])*)\))/;
const LINK_RE = /^\[((?:\\.|[^\]\\])*)\]\((\s*https:\/\/.*?(?:\\[^[\]]|[^)[\]\\\n])*)\)/;
// const LIST_RE = /^( *)([+*-]|\d+\.) +([^\n]+\n?)/;
const LIST_RE = /^( *)([+*-]|(\d+)\.) +([^\n]+(?:\n\1 {2}[^\n]+)*\n?)/;

// TODO: Rework plain text handling

type match_result = { node: markdown_node; fragment_end: number };

export class MarkdownParser {
    at_start_of_line = true;
    in_quote = false;

    static parse(input: string) {
        return new MarkdownParser().parse_document(input);
    }

    parse_document(input: string): document_fragment {
        let cursor = 0;
        const parts: markdown_node[] = [];
        while (cursor < input.length) {
            const { node, fragment_end } = this.parse(input.substring(cursor));
            parts.push(node);
            cursor += fragment_end;
        }
        return {
            type: "doc",
            content: parts,
        };
    }

    update_state(slice: string) {
        for (const c of slice) {
            if (this.at_start_of_line && /\S/.test(c)) {
                this.at_start_of_line = false;
            } else if (!this.at_start_of_line && c === "\n") {
                this.at_start_of_line = true;
            }
        }
    }

    parse(substring: string): match_result {
        const escape_match = substring.match(ESCAPE_RE);
        if (escape_match) {
            this.at_start_of_line = false;
            return {
                node: {
                    type: "plain",
                    content: escape_match[1],
                },
                fragment_end: escape_match[0].length,
            };
        }
        const bold_match = substring.match(BOLD_RE);
        if (bold_match) {
            return {
                node: {
                    type: "format",
                    formatter: "**",
                    content: this.parse_document(bold_match[1]),
                },
                fragment_end: bold_match[0].length,
            };
        }
        const underline_match = substring.match(UNDERLINE_RE);
        if (underline_match) {
            return {
                node: {
                    type: "format",
                    formatter: "__",
                    content: this.parse_document(underline_match[1]),
                },
                fragment_end: underline_match[0].length,
            };
        }
        const italics_match = substring.match(ITALICS_RE);
        if (italics_match) {
            return {
                node: {
                    type: "format",
                    formatter: "*",
                    content: this.parse_document((italics_match[1] as string | undefined) ?? italics_match[2]),
                },
                fragment_end: italics_match[0].length,
            };
        }
        const strikethrough_match = substring.match(STRIKETHROUGH_RE);
        if (strikethrough_match) {
            return {
                node: {
                    type: "format",
                    formatter: "~~",
                    content: this.parse_document(strikethrough_match[1]),
                },
                fragment_end: strikethrough_match[0].length,
            };
        }
        const spoiler_match = substring.match(SPOILER_RE);
        if (spoiler_match) {
            return {
                node: {
                    type: "format",
                    formatter: "||",
                    content: this.parse_document(spoiler_match[1]),
                },
                fragment_end: spoiler_match[0].length,
            };
        }
        const code_block_match = substring.match(CODE_BLOCK_RE);
        if (code_block_match) {
            if (/[^`]/.test(code_block_match[3])) {
                return {
                    node: {
                        type: "code",
                        language: (code_block_match[1] as string | undefined) ?? null,
                        content: code_block_match[3],
                    },
                    fragment_end: code_block_match[0].length,
                };
            }
        }
        const inline_code_match = substring.match(INLINE_CODE_RE);
        if (inline_code_match) {
            if (/[^`]/.test(inline_code_match[2])) {
                return {
                    node: {
                        type: "inline code",
                        content: inline_code_match[2],
                    },
                    fragment_end: inline_code_match[0].length,
                };
            }
        }
        const blockquote_match = substring.match(BLOCKQUOTE_RE);
        if (blockquote_match && this.at_start_of_line && !this.in_quote) {
            this.in_quote = true;
            const content = this.parse_document((blockquote_match[1] as string | undefined) || blockquote_match[2]);
            this.in_quote = false;
            return {
                node: {
                    type: "blockquote",
                    content,
                },
                fragment_end: blockquote_match[0].length,
            };
        }
        const subtext_match = substring.match(SUBTEXT_RE);
        if (subtext_match && this.at_start_of_line) {
            return {
                node: {
                    type: "subtext",
                    content: this.parse_document(subtext_match[1]),
                },
                fragment_end: subtext_match[0].length,
            };
        }
        const header_match = substring.match(HEADER_RE);
        if (header_match && this.at_start_of_line) {
            return {
                node: {
                    type: "header",
                    level: header_match[1].length,
                    content: this.parse_document(header_match[2]),
                },
                fragment_end: header_match[0].length,
            };
        }
        const link_match = substring.match(LINK_RE);
        if (link_match) {
            return {
                node: {
                    type: "masked link",
                    target: link_match[2],
                    content: this.parse_document(link_match[1]),
                },
                fragment_end: link_match[0].length,
            };
        }
        const list_match = substring.match(LIST_RE);
        if (list_match && this.at_start_of_line) {
            const list_node: list = {
                type: "list",
                start_number: (list_match[3] as string | null) ? parseInt(list_match[3]) : null,
                items: [this.parse_document(list_match[4])],
            };
            let fragment_end = list_match[0].length;
            let remaining = substring.substring(fragment_end);
            let list_match_remaining = remaining.match(LIST_RE);
            while (list_match_remaining) {
                list_node.items.push(this.parse_document(list_match_remaining[4]));
                fragment_end += list_match_remaining[0].length;
                remaining = remaining.substring(fragment_end);
                list_match_remaining = remaining.match(LIST_RE);
            }
            return {
                node: list_node,
                fragment_end,
            };
        }
        const text_match = substring.match(TEXT_RE);
        if (text_match) {
            this.update_state(text_match[0]);
            return {
                node: {
                    type: "plain",
                    content: text_match[0],
                },
                fragment_end: text_match[0].length,
            };
        }
        assert(false);
    }
}
