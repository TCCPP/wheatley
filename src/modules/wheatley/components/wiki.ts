import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as fs from "fs";

import { unwrap } from "../../../utils/misc.js";
import { globIterate } from "glob";
import matter from "gray-matter";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import Help from "./help.js";
import { Index, IndexEntry, tokenize } from "../../../algorithm/search.js";
import {
    create_embedding_pipeline,
    generate_embedding,
    cosine_similarity_vectors,
    EMBEDDING_MODEL,
} from "../../../utils/wiki-embeddings.js";
import { load_wiki_web_articles } from "../wiki-article-loader.js";

export type WikiArticle = {
    name: string | null; // basename for the article
    title: string;
    body?: string;
    fields: WikiField[];
    footer?: string;
    image?: string;
    set_author: boolean;
    no_embed: boolean;
    wikilink: string | undefined;
};

type WikiField = {
    name: string;
    value: string;
    inline: boolean;
};

type WikiSearchEntry = IndexEntry & {
    article: WikiArticle;
    aliases: string[];
    content: string;
};

// search tuning
const EXACT_MATCH_BONUS = 5.0;
const ALIAS_WEIGHT = 0.8;
const CONTENT_WEIGHT = 0.4;
const EMBEDDING_WEIGHT = 0.6;
const FUZZY_WEIGHT = 0.4;

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

export const WIKI_ARTICLES_PATH = "wiki/bot-articles";

type substitution_fun = (str: string) => string;

class ArticleParser {
    private readonly aliases = new Set<string>();

    private name!: string | null;
    private title: string | undefined;
    private body?: string;
    private fields: WikiField[] = [];
    private footer?: string;
    private image?: string;
    private set_author = false;
    private no_embed = false;
    private wikilink?: string;
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
        } else if (directive.startsWith("wikilink ")) {
            this.wikilink = directive.substring("wikilink ".length).trim();
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
            wikilink: this.wikilink,
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

export class WikiSearchIndex extends Index<WikiSearchEntry> {
    private embeddings: Map<string, number[]> | null = null;
    private embedding_dimension = 0;
    private extractor: any = null;
    private query_embedding: number[] | null = null;

    constructor(entries: WikiSearchEntry[]) {
        super(entries, (title: string) => [title.toLowerCase()]);
    }

    async load_embeddings() {
        const embeddings_path = "indexes/wiki/embeddings.json";
        try {
            if (!fs.existsSync(embeddings_path)) {
                M.info("Wiki embeddings not found, using fuzzy search only");
                return;
            }
            const data = JSON.parse(await fs.promises.readFile(embeddings_path, "utf-8")) as {
                embeddings: Record<string, number[]>;
                model_info: { model: string; dimension: number };
            };
            this.embeddings = new Map(Object.entries(data.embeddings));
            this.embedding_dimension = data.model_info.dimension;
            const { model } = data.model_info;
            M.info(
                `Loaded ${this.embeddings.size} wiki article embeddings (${model}, dim=${this.embedding_dimension})`,
            );
            M.info(`Loading embedding model ${EMBEDDING_MODEL} for query processing...`);
            this.extractor = await create_embedding_pipeline();
            M.info("Embedding model loaded successfully");
        } catch (e) {
            M.warn("Failed to load wiki embeddings, falling back to fuzzy search only", e);
            this.embeddings = null;
            this.extractor = null;
        }
    }

    override score_entry(query: string, entry: WikiSearchEntry & { parsed_title: string[] }) {
        const base_result = super.score_entry(query, entry);
        const query_lower = query.toLowerCase();
        const title_lower = entry.title.toLowerCase();

        let fuzzy_score = base_result.score;

        if (title_lower === query_lower) {
            fuzzy_score += EXACT_MATCH_BONUS;
        }

        for (const alias of entry.aliases) {
            const alias_score = super.score(query, alias).score;
            if (alias.toLowerCase() === query_lower) {
                fuzzy_score = Math.max(fuzzy_score, alias_score * ALIAS_WEIGHT + EXACT_MATCH_BONUS);
            } else {
                fuzzy_score = Math.max(fuzzy_score, alias_score * ALIAS_WEIGHT);
            }
        }

        if (entry.content) {
            const query_tokens = new Set(tokenize(query));
            const content_tokens = new Set(tokenize(entry.content));
            const common_tokens = [...query_tokens].filter(t => content_tokens.has(t));
            if (common_tokens.length > 0) {
                fuzzy_score += common_tokens.length * CONTENT_WEIGHT;
            }
        }

        let final_score = fuzzy_score;

        if (this.embeddings && this.query_embedding && entry.article.name) {
            const article_embedding = this.embeddings.get(entry.article.name);
            if (article_embedding) {
                const similarity = cosine_similarity_vectors(this.query_embedding, article_embedding);
                const embedding_score = similarity * 10;
                final_score = fuzzy_score * FUZZY_WEIGHT + embedding_score * EMBEDDING_WEIGHT;
            }
        }

        return {
            score: final_score,
            debug_info: base_result.debug_info,
        };
    }

    async search_get_top_5_async(query: string) {
        if (this.extractor) {
            try {
                this.query_embedding = await generate_embedding(query, this.extractor);
            } catch (e) {
                M.warn("Failed to generate query embedding, falling back to fuzzy search only", e);
                this.query_embedding = null;
            }
        }

        const results = this.search_get_top_5(query);
        this.query_embedding = null;
        return results;
    }

    async search_with_suggestions(query: string): Promise<{
        result: WikiSearchEntry | null;
        suggestions: WikiSearchEntry[];
    }> {
        const results = await this.search_get_top_5_async(query);
        return {
            result: results[0] ?? null,
            suggestions: results.slice(1, 4),
        };
    }
}

export function create_wiki_search_entries(
    articles: Record<string, WikiArticle>,
    article_aliases: Map<string, string>,
): WikiSearchEntry[] {
    const entries: WikiSearchEntry[] = [];
    for (const [name, article] of Object.entries(articles)) {
        const aliases: string[] = [];
        for (const [alias, article_name] of article_aliases.entries()) {
            if (article_name === name) {
                aliases.push(alias);
            }
        }
        const content_parts = [article.body ?? "", ...article.fields.map(f => `${f.name} ${f.value}`)];
        const content = content_parts.join(" ").trim();
        entries.push({
            title: article.title,
            article,
            aliases,
            content,
        });
    }

    return entries;
}

function alphabetical_compare(a: string, b: string): number {
    return a.localeCompare(b);
}

export default class Wiki extends BotComponent {
    private bot_spam!: Discord.TextChannel;

    static override get is_freestanding() {
        return true;
    }

    articles: Record<string, WikiArticle> = {};
    article_aliases = new Discord.Collection<string, string>();
    substitute_refs: substitution_fun = str => str;
    wiki_search_index: WikiSearchIndex | null = null;

    override async setup(commands: CommandSetBuilder) {
        this.bot_spam = await this.utilities.get_channel(this.wheatley.channels.bot_spam);

        (this.wheatley.components.get("Help") as Help | undefined)?.add_category_content(
            "Wiki Articles",
            "Article contributions are welcome [here](https://github.com/TCCPP/wiki)!",
        );

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
                .set_category("Wiki Articles")
                .set_description(["Retrieve wiki articles", "Retrieve wiki articles (alternatively /wiki)"])
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                    autocomplete: query => {
                        if (!this.wiki_search_index) {
                            return [];
                        }
                        if (query.trim() === "") {
                            return Object.values(this.articles)
                                .map(article => article.title)
                                .sort(alphabetical_compare)
                                .slice(0, 25)
                                .map(title => ({ name: title, value: title }));
                        }
                        const results = this.wiki_search_index.search_get_top_5(query);
                        return results.slice(0, 25).map(entry => ({ name: entry.title, value: entry.title }));
                    },
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
                .set_category("Wiki Articles")
                .set_slash(false)
                .set_description("Preview wiki article markdown")
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
                    .set_category("Wiki Articles")
                    .set_alias_of("wiki")
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
        for await (const file_path of globIterate(`${WIKI_ARTICLES_PATH}/**/*.md`, { withFileTypes: true })) {
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

        try {
            const wiki_articles = await load_wiki_web_articles();
            const existing_titles = new Set(Object.values(this.articles).map(a => a.title));
            for (const wiki_article of wiki_articles) {
                let parsed;
                try {
                    parsed = parse_article(wiki_article.path, wiki_article.preview, this.substitute_refs);
                } catch (e: any) {
                    this.wheatley.alert(`Failed to parse wiki article preview ${wiki_article.path}: ${e.message}`);
                    continue;
                }
                const [article, aliases] = parsed;
                // Skip if an article with the same title already exists (search index requires unique titles)
                if (existing_titles.has(article.title)) {
                    this.wheatley.warn(
                        `Skipping wiki article ${wiki_article.path}: title "${article.title}" already exists`,
                    );
                    continue;
                }
                existing_titles.add(article.title);
                article.wikilink = wiki_article.url;
                this.articles[wiki_article.path] = article;
                const frontmatter_aliases = Array.isArray(wiki_article.alias)
                    ? wiki_article.alias
                    : wiki_article.alias
                      ? [wiki_article.alias]
                      : [];
                for (const alias of [...aliases, ...frontmatter_aliases]) {
                    this.article_aliases.set(alias, wiki_article.path);
                }
            }
        } catch (e) {
            this.wheatley.alert(`Failed to load wiki web articles: ${e}`);
        }

        // Initialize search index
        const search_entries = create_wiki_search_entries(this.articles, this.article_aliases);
        this.wiki_search_index = new WikiSearchIndex(search_entries);
        await this.wiki_search_index.load_embeddings();
    }

    build_article_embed(
        article: WikiArticle,
        options?: {
            member?: Discord.GuildMember | Discord.User;
        },
    ): Discord.EmbedBuilder {
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle(article.title)
            .setDescription(article.body ?? null)
            .setFields(article.fields);
        if (article.image) {
            embed.setImage(article.image);
        }
        if (article.set_author && options?.member) {
            embed.setAuthor({
                name: options.member.displayName,
                iconURL: options.member.avatarURL() ?? options.member.displayAvatarURL(),
            });
        }
        if (article.footer) {
            embed.setFooter({
                text: article.footer,
            });
        }
        return embed;
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
            const member = article.set_author ? await command.get_member() : undefined;
            const embed = this.build_article_embed(article, { member });
            let components: Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>[] | undefined;
            if (article.wikilink) {
                const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    new Discord.ButtonBuilder()
                        .setLabel("More information on the wiki")
                        .setURL(article.wikilink)
                        .setStyle(Discord.ButtonStyle.Link),
                );
                components = [row];
            }
            await command.reply({
                content: mention ?? undefined,
                embeds: [embed],
                components,
                should_text_reply: true,
            });
        }
    }

    async wiki(command: TextBasedCommand, query: string, user: Discord.User | null) {
        assert(this.wiki_search_index, "Wiki search index not initialized");
        const { result, suggestions } = await this.wiki_search_index.search_with_suggestions(query);
        if (result) {
            await this.send_wiki_article(result.article, command, user);
        } else {
            let error_message = "Couldn't find article";
            if (suggestions.length > 0) {
                const suggestion_titles = suggestions.map(s => s.title).join(", ");
                error_message += `\n\nDid you mean: ${suggestion_titles}?`;
            }
            await command.reply(error_message, true, true);
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
                channel.id === this.bot_spam.id ||
                (channel.isThread() && channel.parentId === this.bot_spam.id) ||
                channel.isDMBased()
            )
        ) {
            await command.reply(
                `!wiki-preview must be used in <#${this.bot_spam.id}>, a bot-spam thread, or a DM`,
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
