import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as fs from "fs";
import * as path from "path";

import { M } from "../utils.js";
import { bot_spam_id, colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

export const wiki_dir = "wiki_articles";

async function* walk_dir(dir: string): AsyncGenerator<string> { // todo: duplicate
    for(const f of await fs.promises.readdir(dir)) {
        const file_path = path.join(dir, f).replace(/\\/g, "/");
        if((await fs.promises.stat(file_path)).isDirectory()) {
            yield* walk_dir(file_path);
        } else {
            yield file_path;
        }
    }
}

type WikiArticle = {
    title: string;
    body: string | null;
    fields: {name: string, value: string, inline: boolean}[],
    footer?: string;
    set_author?: true;
    no_embed?: true;
};

export function parse_article(name: string | null, content: string): [WikiArticle, Map<string, string>] {
    const data: Partial<WikiArticle> = {};
    data.body = "";
    data.fields = [];
    const lines = content.split("\n");
    enum state { body, field, footer }
    let code = false;
    let current_state = state.body;
    const article_aliases: Map<string, string> = new Map();
    for(const [ i, line ] of lines.entries()) {
        if(line.trim().startsWith("```")) {
            code = !code;
        }
        if(line.match(/^#(?!#).+$/) && !code) { // H1
            assert(!data.title, "More than one title (# H1) provided");
            data.title = line.substring(1).trim();
        } else if(line.match(/^##(?!#).+$/) && !code) { // H2
            let name = line.substring(2).trim();
            let inline = false;
            if(name.match(/^\[.+\]$/)) {
                name = name.substring(1, name.length - 1).trim();
                inline = true;
            }
            data.fields.push({
                name,
                value: "",
                inline
            });
            current_state = state.field;
        } else if(line.trim().toLowerCase() == "[[[footer]]]" && !code) {
            current_state = state.footer;
        } else if(line.trim() == "[[[user author]]]" && !code) {
            data.set_author = true;
        } else if(line.trim() == "[[[no embed]]]" && !code) {
            data.no_embed = true;
        } else if(line.trim().match(/^\[\[\[alias .+\]\]\]$/) && !code) {
            const match = line.trim().match(/^\[\[\[alias (.+)\]\]\]$/)!;
            const aliases = match[1].split(",").map(alias => alias.trim());
            // null is passed by the preview command, don't actually want to set aliases in for
            // TODO: Now obsolete since we aren't directly inserting into a global map?
            if(name != null) {
                for(const alias of aliases) {
                    assert(!article_aliases.has(alias));
                    article_aliases.set(alias, name);
                }
            }
        } else if(line.trim().match(/\[\[\[.*\]\]\]/) && !code) {
            throw `Parse error on line ${i + 1}, unrecognized [[[]]] directive`;
        } else {
            const line_with_newline = (() => {
                if(code || line.startsWith("- ")) {
                    return "\n" + line;
                } else {
                    return line.trim() == "" ? "\n" : " " + line;
                }
            })();
            if(current_state == state.body) {
                data.body += line_with_newline;
            } else if(current_state == state.field) {
                data.fields[data.fields.length - 1].value += line_with_newline;
            } else if(current_state == state.footer) { //eslint-disable-line @typescript-eslint/no-unnecessary-condition
                data.footer = (data.footer ?? "") + line_with_newline;
            } else {
                assert(false);
            }
        }
    }
    assert(!code, "Unclosed code block in wiki article");
    data.body = data.body.trim();
    if(data.body == "") {
        data.body = null;
    }
    data.footer = data.footer?.trim();
    assert(data.fields); // will always be true
    if(data.no_embed) {
        assert(data.body, "Must have a body if it's not an embed");
        assert(!data.footer, "Can't have a footer if it's not an embed");
        assert(data.fields.length == 0, "Can't have fields if it's not an embed");
    }
    assert(data.title, "Wiki article must have a title"); // title will just be for search purposes in no embed mode
    // need to do this nonsense for TS....
    const { title, body, fields, footer, set_author, no_embed } = data;
    return [
        {
            title, body, fields, footer, set_author, no_embed
        },
        article_aliases
    ];
}

export class Wiki extends BotComponent {
    articles: Record<string, WikiArticle> = {};
    article_aliases: Map<string, string> = new Map();

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder([ "wiki", "howto" ])
                .set_description([ "Retrieve wiki articles", "Retrieve wiki articles (alternatively /wiki)" ])
                .add_string_option({
                    title: "query",
                    description: "Query",
                    required: true,
                    autocomplete: query =>
                        Object.values(this.articles)
                            .map(article => article.title)
                            .filter(title => title.toLowerCase().includes(query))
                            .map(title => ({ name: title, value: title }))
                            .slice(0, 25)
                })
                .set_handler(this.wiki.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("wiki-preview")
                .set_slash(false)
                .set_description("Preview a wiki article")
                .add_string_option({
                    title: "content",
                    description: "Content",
                    required: true
                })
                .set_handler(this.wiki_preview.bind(this))
        );
    }

    override async setup() {
        await this.load_wiki_pages();
        // setup slash commands for aliases
        for(const [ alias, article_name ] of this.article_aliases.entries()) {
            const article = this.articles[article_name];
            this.add_command(
                new TextBasedCommandBuilder(alias)
                    .set_description(article.title)
                    .set_handler(this.wiki_alias.bind(this))
            );
        }
    }

    async load_wiki_pages() {
        for await(const file_path of walk_dir(wiki_dir)) {
            const name = path.basename(file_path, path.extname(file_path));
            //M.debug(file_path, name);
            if(name == "README") {
                continue;
            }
            const content = await fs.promises.readFile(file_path, { encoding: "utf-8" });
            const [article, aliases] = parse_article(name, content);
            this.articles[name] = article;
            for(const [k, v] of aliases) {
                this.article_aliases.set(k, v);
            }
        }
    }

    async send_wiki_article(article: WikiArticle, command: TextBasedCommand) {
        if(article.no_embed) {
            assert(article.body);
            await command.reply({
                content: article.body,
                should_text_reply: true
            });
        } else {
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.color)
                .setTitle(article.title)
                .setDescription(article.body)
                .setFields(article.fields);
            if(article.set_author) {
                const member = await command.get_member();
                embed.setAuthor({
                    name: member.displayName,
                    iconURL: member.avatarURL() ?? command.user.displayAvatarURL()
                });
            }
            if(article.footer) {
                embed.setFooter({
                    text: article.footer
                });
            }
            await command.reply({
                embeds: [embed],
                should_text_reply: true
            });
        }
    }

    async wiki(command: TextBasedCommand, query: string) {
        const matching_articles = Object
            .entries(this.articles)
            .filter(([ name, { title }]) => name == query.replaceAll("-", "_") || title == query)
            .map(([ _, article ]) => article);
        const article = matching_articles.length > 0 ? matching_articles[0] : undefined;
        M.log(`Received !wiki command for ${article}`);
        if(article) {
            await this.send_wiki_article(article, command);
        } else {
            await command.reply("Couldn't find article", true, true);
            return;
        }
    }

    async wiki_alias(command: TextBasedCommand) {
        assert(this.article_aliases.has(command.name));
        M.log(`Received ${command.name} (wiki alias)`, command.user.id, command.user.tag, command.get_or_forge_url());
        const article_name = this.article_aliases.get(command.name)!;
        await this.send_wiki_article(this.articles[article_name], command);
    }

    async wiki_preview(command: TextBasedCommand, content: string) {
        M.log("Received wiki preview command", command.user.id, command.user.tag, command.get_or_forge_url());
        if(command.channel_id != bot_spam_id) {
            await command.reply(`!wiki-preview must be used in <#${bot_spam_id}>`, true, true);
            return;
        }
        let article: WikiArticle;
        try {
            article = parse_article(null, content)[0];
        } catch(e) {
            await command.reply("Parse error: " + e, true, true);
            return;
        }
        try {
            await this.send_wiki_article(article, command);
        } catch(e) {
            await command.reply("Error while building / sending: " + e, true, true);
        }
    }
}
