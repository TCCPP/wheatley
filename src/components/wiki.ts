import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as fs from "fs";

import { unwrap } from "../utils/misc.js";
import { globIterate } from "glob";
import matter from "gray-matter";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

type WikiArticle = {
    name: string | null; // basename for the article
    title: string;
    body?: string;
    fields: WikiField[];
    footer?: string;
    image?: string;
    set_author: boolean;
    no_embed: boolean;
};

type WikiField = {
    name: string;
    value: string;
    inline: boolean;
};

enum parse_state {
    body,
    field,
    footer,
    before_inline_field,
    done,
}

const image_regex = /!\[[^\]]*]\(([^)]*)\)/;
const reference_definition_regex = /\s*\[([^\]]*)]: (.+)/;
const reference_link_regex = /\[([^\]]*)]\[([^\]]*)]/g;

export const wiki_path = "wiki";
export const wiki_articles_path = "wiki/articles";

type substitution_fun = (str: string) => string;

class ArticleParser {
    private readonly aliases = new Set<string>();

    private name: string | null;
    private title: string | undefined;
    private body?: string;
    private fields: WikiField[] = [];
    private footer?: string;
    private image?: string;
    private set_author = false;
    private no_embed = false;
    private readonly reference_definitions = new Map<string, string>();

    private current_state = parse_state.body;
    private in_code = false;
    private last_was_blockquote = false;

    constructor(private readonly substitute_refs: substitution_fun) {}

    parse(name: string | null, content: string) {
        this.name = name;
        this.body = "";
        const lines = content.split(/\r?\n/);
        this.collect_references(lines);
        for (const line of lines) {
            this.parse_line(line);
        }
        assert(!this.in_code, "Unclosed code block in wiki article");
        assert(this.current_state !== parse_state.before_inline_field, "Trailing inline field directive");

        this.body = this.body.trim();
        if (this.body === "") {
            this.body = undefined;
        }

        // title will just be for search purposes in no embed mode
        assert(this.title, "Wiki article must have a title");

        this.footer = this.footer?.trim();
        assert(this.fields); // will always be true

        if (this.no_embed) {
            assert(this.body, "Must have a body if it's not an embed");
            assert(!this.footer, "Can't have a footer if it's not an embed");
            assert(this.fields.length == 0, "Can't have fields if it's not an embed");
        }

        this.current_state = parse_state.done;
    }

    private parse_line(line: string): void {
        const trimmed = line.trim();
        if (trimmed.startsWith("```")) {
            this.in_code = !this.in_code;
            this.parse_regular_line(line);
        } else if (!this.in_code && line.startsWith("#")) {
            this.parse_heading(line);
        } else if (!this.in_code && trimmed.startsWith("<!--") && trimmed.endsWith("-->")) {
            const directive = trimmed.match(/^<!--(.*?)-->$/)![1].trim();
            this.parse_directive(directive);
        } else if (trimmed === "---") {
            this.parse_directive(trimmed);
        } else if (trimmed.match(image_regex)) {
            this.parse_directive(trimmed);
        } else if (trimmed.match(reference_definition_regex)) {
            // ignore
        } else {
            this.parse_regular_line(line);
        }
    }

    /**
     * Parses one line, starting with #.
     * @param line the line
     */
    private parse_heading(line: string): void {
        const level = line.search(/[^#]/);
        assert(level >= 1, "Cannot parse heading that has no heading level");

        if (level === 1) {
            assert(this.title === undefined, "Duplicate title heading");
            this.title = line.substring(1).trim();
            this.current_state = parse_state.body;
        } else if (level === 2) {
            const name = this.substitute_refs(line.substring(2).trim());
            const inline = this.current_state === parse_state.before_inline_field;
            const field = { name, value: "", inline };
            this.fields.push(field);
            this.current_state = parse_state.field;
            return;
        } else {
            this.parse_regular_line(line);
        }
    }

    /**
     * Parses a directive. Directives are HTML comments in Markdown with special meaning.
     * This function accepts the contents of such a comment, without the opening `<!--` and closing `-->`.
     * @param directive the directive to parse
     */
    private parse_directive(directive: string): void {
        if (directive === "inline") {
            this.current_state = parse_state.before_inline_field;
        } else if (directive === "---") {
            this.current_state = parse_state.footer;
        } else if (directive === "user author") {
            this.set_author = true;
        } else if (directive === "no embed") {
            this.no_embed = true;
        } else if (directive.match(image_regex)) {
            const match = unwrap(directive.match(image_regex))[1];
            this.image = match.trim();
        } else if (directive.startsWith("alias ")) {
            const aliases = directive
                .substring("alias ".length)
                .split(",")
                .map(alias => alias.trim());
            for (const alias of aliases) {
                assert(!this.aliases.has(alias));
                this.aliases.add(alias);
            }
        } else {
            M.warn(`Unknown directive encountered while parsing article: ${directive}`);
        }
    }

    private parse_regular_line(line: string): void {
        if (this.current_state === parse_state.before_inline_field && line.trim() === "") {
            return;
        }

        const requires_line_break =
            this.in_code ||
            (line.startsWith(">") && this.last_was_blockquote) ||
            line.startsWith("```") ||
            line.startsWith("#") ||
            line.trim() === "" ||
            line.trim().startsWith("- ") ||
            line.trim().match(/^\d+.*$/);
        const terminator = requires_line_break ? "\n" : "";
        const terminated_line = this.substitute_placeholders(line + terminator);

        const append_line = (content: string) => {
            if (content.length !== 0) {
                const tail = content[content.length - 1];
                if (requires_line_break) {
                    if (tail !== "\n") {
                        content += "\n";
                    }
                } else if (!/\s/.test(tail)) {
                    content += " ";
                }
            }
            return content + terminated_line;
        };

        if (this.current_state === parse_state.body) {
            this.body = append_line(this.body!);
        } else if (this.current_state === parse_state.field) {
            this.fields[this.fields.length - 1].value = append_line(this.fields[this.fields.length - 1].value);
        } else if (this.current_state === parse_state.footer) {
            this.footer = append_line(this.footer ?? "");
        } else {
            assert(false, `unexpected state: ${this.current_state}`);
        }

        if (!this.in_code && line.startsWith(">")) {
            this.last_was_blockquote = true;
        }
    }

    /**
     * Substitutes placeholders such as <br> or reference-style links in the
     * string, but only outside inline code.
     * @param line the line, possibly containing backticks for inline code
     */
    private substitute_placeholders(line: string): string {
        if (this.in_code) {
            return line;
        }
        let result = "";
        let piece = "";
        let in_inline_code = false;
        let prev = "";
        for (const c of line) {
            if (c === "`") {
                if (in_inline_code) {
                    result += piece + c;
                    piece = "";
                } else {
                    result += this.substitute_placeholders_no_code(piece);
                    piece = c;
                }
                in_inline_code = prev !== "\\" ? !in_inline_code : in_inline_code;
            } else {
                piece += c;
            }
            prev = c;
        }
        return result + (in_inline_code ? piece : this.substitute_placeholders_no_code(piece));
    }

    /**
     * Substitutes placeholders in a string with no backticks, i.e. no
     * possibility of having inline code.
     * @param str the string to substitute in
     */
    private substitute_placeholders_no_code(str: string): string {
        return this.substitute_refs(str)
            .replace(/<br>\n|<br\/>\n/, "\n")
            .replaceAll(/<br>|<br\/>/g, "\n")
            .replaceAll(reference_link_regex, (_, text: string, ref: string) => {
                assert(this.reference_definitions.has(ref), "Unknown reference in reference-style link");
                return `[${text}](${this.reference_definitions.get(ref)})`;
            });
    }

    private collect_references(lines: string[]) {
        for (const line of lines) {
            if (line.match(reference_definition_regex)) {
                const [_, key, value] = unwrap(line.match(reference_definition_regex));
                this.reference_definitions.set(key.trim(), value.trim());
            }
        }
    }

    get is_done(): boolean {
        return this.current_state === parse_state.done;
    }

    get article(): WikiArticle {
        assert(this.is_done, "Attempting to access article of a parser without success");
        return {
            name: this.name,
            title: unwrap(this.title),
            body: this.body,
            fields: this.fields,
            footer: this.footer,
            image: this.image,
            set_author: this.set_author,
            no_embed: this.no_embed,
        };
    }

    get article_aliases(): Set<string> {
        assert(this.is_done, "Attempting to access aliases of a parser without success");
        return this.aliases;
    }
}

export function parse_article(
    name: string | null,
    content: string,
    substitute_refs: substitution_fun,
): [WikiArticle, Set<string>] {
    const parser = new ArticleParser(substitute_refs);
    parser.parse(name, content);
    return [parser.article, parser.article_aliases];
}

export default class Wiki extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    articles: Record<string, WikiArticle> = {};
    article_aliases = new Discord.Collection<string, string>();
    substitute_refs: substitution_fun = str => str;

    override async setup(commands: CommandSetBuilder) {
        const emoji_map = new Map<string, string>();
        for (const [id, emoji] of this.wheatley.guild.emojis.cache) {
            if (emoji.name) {
                emoji_map.set(`:${emoji.name}:`, `<:${emoji.identifier}>`);
            }
        }
        const match_emoji = new RegExp(`(?<!<)(?:${[...emoji_map.keys()].join("|")})`, "g");

        const channel_map = new Map<string, string>();
        for (const [id, channel] of this.wheatley.guild.channels.cache) {
            if (channel.name.match(/^[a-zA-Z0-9-]+$/g)) {
                channel_map.set(`#${channel.name}`, `<#${id}>`);
            }
        }
        const match_channel = new RegExp(`(?:${[...channel_map.keys()].join("|")})(?![a-zA-Z0-9_])`, "g");

        this.substitute_refs = (str: string) => {
            return str
                .replaceAll(match_emoji, match => emoji_map.get(match)!)
                .replaceAll(match_channel, match => channel_map.get(match)!);
        };

        commands.add(
            new TextBasedCommandBuilder(["wiki", "howto"], EarlyReplyMode.none)
                .set_description(["Retrieve wiki articles", "Retrieve wiki articles (alternatively /wiki)"])
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                    autocomplete: query =>
                        Object.values(this.articles)
                            .map(article => article.title)
                            .filter(title => title.toLowerCase().includes(query))
                            .map(title => ({ name: title, value: title }))
                            .slice(0, 25),
                })
                .add_user_option({
                    title: "user",
                    description: "ping the requested user in the bot reply",
                    required: false,
                })
                .set_handler(this.wiki.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder(["wiki-preview", "wp"], EarlyReplyMode.none)
                .set_slash(false)
                .set_description("Preview a wiki article")
                .add_string_option({
                    title: "content",
                    description: "Content",
                    required: true,
                })
                .set_handler(this.wiki_preview.bind(this)),
        );

        await this.load_wiki_pages();
        // setup slash commands for aliases
        for (const [alias, article_name] of this.article_aliases.entries()) {
            const article = this.articles[article_name];
            commands.add(
                new TextBasedCommandBuilder(alias, EarlyReplyMode.none)
                    .set_slash(false)
                    .set_description(article.title)
                    .add_user_option({
                        title: "user",
                        description: "ping the requested user in the bot reply",
                        required: false,
                    })
                    .set_handler(this.wiki_alias.bind(this)),
            );
        }
    }

    async load_wiki_pages() {
        for await (const file_path of globIterate(`${wiki_articles_path}/**/*.md`, { withFileTypes: true })) {
            const content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            let parsed;
            try {
                parsed = parse_article(file_path.name, content, this.substitute_refs);
            } catch (e: any) {
                M.error(`Failed to parse article ${file_path}: ${e.message}`);
                continue;
            }
            const [article, aliases] = parsed;
            this.articles[file_path.name] = article;
            for (const alias of aliases) {
                this.article_aliases.set(alias, file_path.name);
            }
        }
        for await (const file_path of globIterate(`${wiki_path}/src/**/*.md`, { withFileTypes: true })) {
            const file_content = await fs.promises.readFile(file_path.fullpath(), { encoding: "utf-8" });
            const { data } = matter(file_content);
            if (data.preview) {
                let parsed;
                try {
                    parsed = parse_article(file_path.name, data.preview, this.substitute_refs);
                } catch (e: any) {
                    M.error(`Failed to parse article ${file_path}: ${e.message}`);
                    continue;
                }
                const [article, aliases] = parsed;
                this.articles[file_path.name] = article;
                for (const alias of [...aliases, ...(data.alias ? [data.alias as string] : [])]) {
                    this.article_aliases.set(alias, file_path.name);
                }
            }
        }
    }

    async send_wiki_article(article: WikiArticle, command: TextBasedCommand, user: Discord.User | null) {
        M.log(`Sending wiki article "${article.name}"`);
        let mention: string | null = null;
        if (user) {
            mention = user.toString();
        }
        if (article.no_embed) {
            assert(article.body);
            await command.reply({
                content: (mention ? mention + "\n" : "") + article.body,
                should_text_reply: true,
            });
        } else {
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setTitle(article.title)
                .setImage(article.image ?? null)
                .setDescription(article.body ?? null)
                .setFields(article.fields);
            if (article.set_author) {
                const member = await command.get_member();
                embed.setAuthor({
                    name: member.displayName,
                    iconURL: member.avatarURL() ?? command.user.displayAvatarURL(),
                });
            }
            if (article.footer) {
                embed.setFooter({
                    text: article.footer,
                });
            }
            await command.reply({
                content: mention ?? undefined,
                embeds: [embed],
                should_text_reply: true,
            });
        }
    }

    async wiki(command: TextBasedCommand, query: string, user: Discord.User | null) {
        const matching_articles = Object.entries(this.articles)
            .filter(([name, { title }]) => name == query || title == query)
            .map(([_, article]) => article);
        const article = matching_articles.length > 0 ? matching_articles[0] : undefined;
        if (article) {
            await this.send_wiki_article(article, command, user);
        } else {
            await command.reply("Couldn't find article", true, true);
        }
    }

    async wiki_alias(command: TextBasedCommand, user: Discord.User | null) {
        assert(this.article_aliases.has(command.name));
        const article_name = this.article_aliases.get(command.name)!;
        await this.send_wiki_article(this.articles[article_name], command, user);
    }

    async wiki_preview(command: TextBasedCommand, content: string) {
        const channel = await command.get_channel();
        if (
            !(
                this.wheatley.freestanding ||
                channel.id === this.wheatley.channels.bot_spam.id ||
                (channel.isThread() && channel.parentId === this.wheatley.channels.bot_spam.id) ||
                channel.isDMBased()
            )
        ) {
            await command.reply(
                `!wiki-preview must be used in <#${this.wheatley.channels.bot_spam.id}>, a bot-spam thread, or a DM`,
                true,
                true,
            );
            return;
        }
        let article: WikiArticle;
        try {
            article = parse_article(null, content, this.substitute_refs)[0];
        } catch (e) {
            await command.reply("Parse error: " + e, true, true);
            M.debug(e);
            return;
        }
        try {
            await this.send_wiki_article(article, command, null);
        } catch (e) {
            await command.reply("Error while building / sending: " + e, true, true);
        }
    }
}
