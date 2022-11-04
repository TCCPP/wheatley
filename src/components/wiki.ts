import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as fs from "fs";
import * as path from "path";

import { critical_error, M } from "../utils";
import { colors, is_authorized_admin } from "../common";
import { make_message_deletable } from "./deletable";
import { SlashCommandBuilder } from "discord.js";
import { GuildCommandManager } from "../infra/guild_command_manager";

let client: Discord.Client;

const wiki_dir = "wiki_articles";

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
    body: string;
    fields: {name: string, value: string, inline: boolean}[],
    footer?: string;
    set_author?: true;
};

const articles: Record<string, WikiArticle> = {};

const article_aliases: Map<string, string> = new Map();

async function send_wiki_article(article: WikiArticle, message: Discord.Message) {
    const embed = new Discord.EmbedBuilder()
        .setColor(colors.color)
        .setTitle(article.title)
        .setDescription(article.body)
        .setFields(article.fields);
    if(article.footer) {
        embed.setFooter({
            text: article.footer
        });
    }
    const reply = await message.channel.send({embeds: [embed]});
    make_message_deletable(message, reply);
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if((message.content.startsWith("!wiki") || message.content.startsWith("!howto"))
        && is_authorized_admin(message.member!)) {
            M.log("got wiki command");
            const query = message.content.startsWith("!wiki") ?
                message.content.substring("!wiki".length).trim()
                : message.content.substring("!howto".length).trim();
            if(query in articles) {
                const article = articles[query];
                await send_wiki_article(article, message);
            }
            return;
        }
        // check aliases
        if(message.content.startsWith("!") && article_aliases.has(message.content.substring(1))) {
            const article_name = article_aliases.get(message.content.substring(1))!;
            await send_wiki_article(articles[article_name], message);
            return;
        }
    } catch(e) {
        critical_error(e);
        try {
            message.reply("Internal error while replying to !wiki");
        } catch(e) {
            critical_error(e);
        }
    }
}

async function send_wiki_article_slash(article: WikiArticle, interaction: Discord.ChatInputCommandInteraction) {
    const embed = new Discord.EmbedBuilder()
        .setColor(colors.color)
        .setTitle(article.title)
        .setDescription(article.body)
        .setFields(article.fields);
    if(article.footer) {
        embed.setFooter({
            text: article.footer
        });
    }
    await interaction.reply({embeds: [embed]});
}

async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && (interaction.commandName == "wiki" || interaction.commandName == "howto")) {
        assert(interaction.isChatInputCommand());
        const query = interaction.options.getString("article_name");
        if(!query) {
            await interaction.reply({
                content: "You must provide a query",
                ephemeral: true
            });
            return;
        }
        const matching_articles = Object.values(articles).filter(({title}) => title == query);
        const article = matching_articles.length > 0 ? matching_articles[0] : undefined;
        if(article) {
            await send_wiki_article_slash(article, interaction);
        } else {
            await interaction.reply({
                content: "Couldn't find article",
                ephemeral: true
            });
            return;
        }
    } else if(interaction.isAutocomplete()
    && (interaction.commandName == "wiki" || interaction.commandName == "howto")) {
        const query = interaction.options.getFocused();
        await interaction.respond(
            Object.values(articles)
                .map(article => article.title)
                .filter(title => title.toLowerCase().includes(query))
                .map(title => ({ name: title, value: title }))
                .slice(0, 25),
        );
    } else if(interaction.isCommand() && article_aliases.has(interaction.commandName)) {
        assert(interaction.isChatInputCommand());
        const article_name = article_aliases.get(interaction.commandName)!;
        await send_wiki_article_slash(articles[article_name], interaction);
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

function parse_article(name: string, content: string): WikiArticle {
    const data: Partial<WikiArticle> = {};
    data.body = "";
    data.fields = [];
    const lines = content.split("\n");
    enum state { body, field, footer }
    let code = false;
    let current_state = state.body;
    for(const line of lines) {
        if(line.trim().startsWith("```")) {
            code = !code;
        }
        if(line.match(/^#(?!#).+$/) && !code) { // H1
            assert(!data.title);
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
        } else if(line.trim().toLowerCase() == "<!-- footer -->" && !code) {
            current_state = state.footer;
        } else if(line.trim() == "[[user author]]" && !code) {
            data.set_author = true;
        } else if(line.trim().match(/^\[\[alias .+\]\]$/) && !code) {
            const match = line.trim().match(/^\[\[alias (.+)\]\]$/)!;
            const aliases = match[1].split(",").map(alias => alias.trim());
            for(const alias of aliases) {
                assert(!article_aliases.has(alias));
                article_aliases.set(alias, name);
            }
        } else {
            if(current_state == state.body) {
                data.body += `\n${line}`;
            } else if(current_state == state.field) {
                data.fields[data.fields.length - 1].value += `\n${line}`;
            } else if(current_state == state.footer) { //eslint-disable-line @typescript-eslint/no-unnecessary-condition
                data.footer = (data.footer ?? "") + `\n${line}`;
            } else {
                assert(false);
            }
        }
    }
    data.body = data.body.trim();
    data.footer = data.footer?.trim();
    assert(data.title);
    assert(data.fields);
    // need to do this nonsense for TS....
    const {title, body, fields, footer, set_author} = data;
    return {
        title, body, fields, footer, set_author
    };
}

async function load_wiki_pages() {
    for await(const file_path of walk_dir(wiki_dir)) {
        const name = path.basename(file_path, path.extname(file_path));
        //M.debug(file_path, name);
        if(name == "README") {
            continue;
        }
        const content = await fs.promises.readFile(file_path, {encoding: "utf-8"});
        articles[name] = parse_article(name, content);
    }
}

export async function setup_wiki(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    try {
        client = _client;
        const wiki = new SlashCommandBuilder()
            .setName("wiki")
            .setDescription("Retrieve wiki articles")
            .addStringOption(option =>
                option.setName("article_name")
                    .setRequired(true)
                    .setDescription("Phrase to search for")
                    .setAutocomplete(true));
        guild_command_manager.register(wiki);
        const howto = new SlashCommandBuilder()
            .setName("howto")
            .setDescription("Retrieve wiki articles (alternatively /wiki)")
            .addStringOption(option =>
                option.setName("article_name")
                    .setRequired(true)
                    .setDescription("Phrase to search for")
                    .setAutocomplete(true));
        guild_command_manager.register(howto);
        client.on("ready", on_ready);
        await load_wiki_pages();
        // setup slash commands for aliases
        for(const [alias, article_name] of article_aliases.entries()) {
            const article = articles[article_name];
            const command = new SlashCommandBuilder()
                .setName(alias)
                .setDescription(article.title);
            guild_command_manager.register(command);
        }
    } catch(e) {
        critical_error(e);
    }
}
