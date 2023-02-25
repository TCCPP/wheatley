These wiki articles were contributed by member of the Together C & C++ discord server

## How to contribute

Make a PR either adding or modifying a .md file in this folder, or submit an issue about an article.

## Wiki markdown

Everything discord supports plus the following:

- `# H1`: Article title
- `## H2`: Discord embed field header, everything that follows will be part of that field
- `## [H2]`: Inline discord embed field, everything that follows will be part of that field
- `[[[footer]]]`: Footer marker, everything that follows will be part of the footer
- `[[[user author]]]`: Set the discord embed's author to the command invoker
- `[[[alias x, y, z]]]`: Make `!x`, `!y`, and `!z` commands for pulling up the article

A note about whitespace: You can split a paragraph's text over multiple source lines. For an actual newline, write an
empty line. The one exception is bullet points (`- foobar`). Code blocks start/stop directives (\`\`\`) must appear at
the start of a line.

## Previewing wiki articles

To test out a wiki article use `!wiki-preview <entire article content>` on the server.
