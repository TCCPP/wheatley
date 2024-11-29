import { strict as assert } from "assert";
import { document_fragment, list, markdown_node } from "./markdown_nodes.js";
import { unwrap } from "./misc.js";

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
// Masked links disallow "https://" in the masked text
// [foo[foo](https://google.com)](https://google.com) is rendered as plain text
// [foo[foo](google.com)](https://google.com) renders as the masked link "foo[foo](google.com)"
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

type parse_result = { node: markdown_node; fragment_end: number };
type match_result = RegExpMatchArray;

type parser_state = {
    at_start_of_line: boolean;
    in_quote: boolean;
};

abstract class Rule {
    abstract match(remaining: string, parser: MarkdownParser): match_result | null;
    abstract parse(match: match_result, parser: MarkdownParser, remaining: string): parse_result;
    coalesce?(a: markdown_node, b: markdown_node): markdown_node | null;
}

class EscapeRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(ESCAPE_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        parser.state.at_start_of_line = false;
        return {
            node: {
                type: "plain",
                content: match[1],
            },
            fragment_end: match[0].length,
        };
    }
}

class BoldRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(BOLD_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "format",
                formatter: "**",
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class UnderlineRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(UNDERLINE_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "format",
                formatter: "__",
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class ItalicsRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(ITALICS_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "format",
                formatter: "*",
                content: parser.parse_document((match[1] as string | undefined) ?? match[2]),
            },
            fragment_end: match[0].length,
        };
    }
}

class StrikethroughRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(STRIKETHROUGH_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "format",
                formatter: "~~",
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class SpoilerRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(SPOILER_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "format",
                formatter: "||",
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class CodeBlockRule extends Rule {
    override match(remaining: string): match_result | null {
        const match = remaining.match(CODE_BLOCK_RE);
        if (match && /[^`]/.test(match[3])) {
            return match;
        } else {
            return null;
        }
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "code",
                language: (match[1] as string | undefined) ?? null,
                content: match[3],
            },
            fragment_end: match[0].length,
        };
    }
}

class InlineCodeRule extends Rule {
    override match(remaining: string): match_result | null {
        const match = remaining.match(INLINE_CODE_RE);
        if (match && /[^`]/.test(match[2])) {
            return match;
        } else {
            return null;
        }
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "inline code",
                content: match[2],
            },
            fragment_end: match[0].length,
        };
    }
}

class BlockquoteRule extends Rule {
    override match(remaining: string, parser: MarkdownParser): match_result | null {
        return parser.state.at_start_of_line && !parser.state.in_quote ? remaining.match(BLOCKQUOTE_RE) : null;
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        parser.state.in_quote = true;
        const content = parser.parse_document((match[1] as string | undefined) || match[2]);
        parser.state.in_quote = false;
        return {
            node: {
                type: "blockquote",
                content,
            },
            fragment_end: match[0].length,
        };
    }
}

class SubtextRule extends Rule {
    override match(remaining: string, parser: MarkdownParser): match_result | null {
        return parser.state.at_start_of_line ? remaining.match(SUBTEXT_RE) : null;
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "subtext",
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class HeaderRule extends Rule {
    override match(remaining: string, parser: MarkdownParser): match_result | null {
        return parser.state.at_start_of_line ? remaining.match(HEADER_RE) : null;
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "header",
                level: match[1].length,
                content: parser.parse_document(match[2]),
            },
            fragment_end: match[0].length,
        };
    }
}

class LinkRule extends Rule {
    override match(remaining: string, parser: MarkdownParser): match_result | null {
        return remaining.match(LINK_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        return {
            node: {
                type: "masked link",
                target: match[2],
                content: parser.parse_document(match[1]),
            },
            fragment_end: match[0].length,
        };
    }
}

class ListRule extends Rule {
    override match(remaining: string, parser: MarkdownParser): match_result | null {
        return parser.state.at_start_of_line ? remaining.match(LIST_RE) : null;
    }

    override parse(match: match_result, parser: MarkdownParser, remaining: string): parse_result {
        const list_node: list = {
            type: "list",
            start_number: (match[3] as string | null) ? parseInt(match[3]) : null,
            items: [parser.parse_document(match[4])],
        };
        let fragment_end = match[0].length;
        let next_match;
        while ((next_match = this.match(remaining.substring(fragment_end), parser))) {
            list_node.items.push(parser.parse_document(next_match[4]));
            fragment_end += next_match[0].length;
        }
        return {
            node: list_node,
            fragment_end,
        };
    }
}

class TextRule extends Rule {
    override match(remaining: string): match_result | null {
        return remaining.match(TEXT_RE);
    }

    override parse(match: match_result, parser: MarkdownParser): parse_result {
        parser.update_state(match[0]);
        return {
            node: {
                type: "plain",
                content: match[0],
            },
            fragment_end: match[0].length,
        };
    }

    override coalesce(a: markdown_node, b: markdown_node): markdown_node | null {
        if (a.type !== "plain" || b.type !== "plain") {
            return null;
        }
        return {
            type: "plain",
            content: a.content + b.content,
        };
    }
}

export class MarkdownParser {
    public state: parser_state = {
        at_start_of_line: true,
        in_quote: false,
    };

    readonly rules = [
        new EscapeRule(),
        new BoldRule(),
        new UnderlineRule(),
        new ItalicsRule(),
        new StrikethroughRule(),
        new SpoilerRule(),
        new CodeBlockRule(),
        new InlineCodeRule(),
        new BlockquoteRule(),
        new SubtextRule(),
        new HeaderRule(),
        new LinkRule(),
        new ListRule(),
        new TextRule(),
    ];

    static parse(input: string) {
        return new MarkdownParser().parse_document(input);
    }

    parse_document(input: string): document_fragment {
        let cursor = 0;
        const parts: markdown_node[] = [];
        while (cursor < input.length) {
            const { node, fragment_end } = this.parse(input.substring(cursor));
            parts.push(node);
            this.try_coalesce_new_parts(parts);
            cursor += fragment_end;
        }
        return {
            type: "doc",
            content: parts,
        };
    }

    public update_state(slice: string) {
        for (const c of slice) {
            if (this.state.at_start_of_line && /\S/.test(c)) {
                this.state.at_start_of_line = false;
            } else if (!this.state.at_start_of_line && c === "\n") {
                this.state.at_start_of_line = true;
            }
        }
    }

    parse(remaining: string): parse_result {
        for (const rule of this.rules) {
            const match = rule.match(remaining, this);
            if (match) {
                return rule.parse(match, this, remaining);
            }
        }
        throw new Error(`No match when parsing ${remaining}`);
    }

    try_coalesce_new_parts(parts: markdown_node[]) {
        if (parts.length < 2) {
            return;
        }
        for (const rule of this.rules) {
            if (rule.coalesce) {
                const coalesced = rule.coalesce(unwrap(parts.at(-2)), unwrap(parts.at(-1)));
                if (coalesced) {
                    parts.splice(parts.length - 2, 2, coalesced);
                }
            }
        }
    }
}
