import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { RequestInfo, RequestInit, Response } from 'node-fetch';
const fetch = (url: RequestInfo, init?: RequestInit) =>
  import("node-fetch").then(({ default: fetch }) => fetch(url, init));

import { async_exec_file, critical_error, M } from "../utils";
import { is_authorized_admin, MINUTE } from "../common";

let client: Discord.Client;

const color = 0x7E78FE; //0xA931FF;

const clang_format_path = "/usr/bin/clang-format";

const max_attachment_length = 1024 * 10;

const default_clang_format_language = "cpp";

// highlight js accepts all
const languages = new Set(["c", "h", "cpp", "hpp", "cc", "hh", "cxx", "cxx", "c++", "h++"]);

const languages_re = new RegExp([...languages]
    .sort((a, b) => b.length - a.length)
    .map(x => x.replaceAll("+", "\\+"))
    .join("|")
);

const code_begin = [
    "//",
    "/\\*",

    "#\\w+",

    "class",
    "struct",
    "typedef",
    "static",
    "inline",
    "template",
    "using namespace",

    "switch\\s*\\(",
    "if\\s*\\(",
    "for\\s*\\(",
    "while\\s*\\(",
    "do\\s*\\{",
    "main\\s*\\(",
    "main\\s*\\(",

    "char",
    "int",
    "unsigned",
    "long",
];

const code_begin_re = new RegExp(code_begin.join("|"));

const code_block_re = new RegExp(`\`\`\`(?:${languages_re.source}\b)?(.*?)\`\`\``, "gms");

async function clang_format(text: string, args: string[]) {
    const {stdout, stderr} = await async_exec_file(clang_format_path, args, {}, text);
    if(stderr.toString("utf8").trim().length != 0) {
        M.debug("Clang format stderr", stderr.toString("utf8"));
    }
    return stdout.toString("utf8");
}

export async function clang_format_embed_code(text: string) {
    return await clang_format(text, [
        "-style={BasedOnStyle: Chromium, IndentWidth: 2, ColumnLimit: 48, AlignAfterOpenBracket: AlwaysBreak}"
    ]);
}

export async function clang_format_general(text: string) {
    return await clang_format(text, [ "-style={BasedOnStyle: Chromium, IndentWidth: 4}" ]);
}

// https://stackoverflow.com/questions/12568097/how-can-i-replace-a-string-by-range
function replace_range(s: string, start: number, end: number, substitute: string) {
    return s.substring(0, start) + substitute + s.substring(end);
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content == ".f"
        && is_authorized_admin(message.member!)) {
            if(message.type == Discord.MessageType.Reply) {
                const replying_to = await message.fetchReference();

                if(replying_to.author.bot) {
                    message.reply("Can't format a bot message");
                    return;
                }

                let content = replying_to.content;
                // does the message have code blocks?
                const code_blocks: string[] = [];
                content = content.replaceAll(code_block_re, (_, block) => {
                    code_blocks.push(block);
                    return `<[<[<[<[${code_blocks.length - 1}]>]>]>]>`;
                });
                M.debug(code_blocks);
                // else ...
                if(code_blocks.length == 0) {
                    const start = content.search(code_begin_re);
                    if(start > -1) {
                        const end = Math.max(...[...";}"].map(c => content.lastIndexOf(c)));
                        if(end > start) {
                            code_blocks.push(content.substring(start, end + 1));
                            content = replace_range(content, start, end + 1, `<[<[<[<[${code_blocks.length - 1}]>]>]>]>`);
                        }
                    }
                }

                for(const [i, block] of code_blocks.entries()) {
                    content = content.replace(`<[<[<[<[${i}]>]>]>]>`, `\`\`\`cpp\n${
                        await clang_format_general(block)
                    }\n\`\`\``);
                }

                // does the message have attachments?
                const attachments = await Promise.all([...replying_to.attachments.values()]
                    .filter(attachment => attachment.contentType?.startsWith("text/") ?? false)
                    .slice(0, 2) // at most 2 attachments
                    .map(async (attachment) => {
                        const fetch_response = await fetch(attachment.url);
                        if(fetch_response.ok) {
                            const text = await fetch_response.text();
                            return new Discord.AttachmentBuilder(
                                await clang_format_general(text),
                                {
                                    name: `${attachment}.cpp`
                                }
                            );
                        } else {
                            return null;
                        }
                    })
                );

                if(attachments.length || code_blocks.length > 0) {
                    const embed = new Discord.EmbedBuilder()
                        .setColor(color)
                        .setAuthor({
                            name: replying_to.member?.displayName ?? replying_to.author.tag,
                            iconURL: replying_to.author.displayAvatarURL()
                        })
                        .setDescription(content)
                        .setFooter({
                            text: `Formatted by ${message.member?.displayName ?? message.author.tag}`,
                            iconURL: message.author.displayAvatarURL()
                        });
                    await message.channel.send({
                        embeds: [embed],
                        files: attachments.filter(x => x != null) as Discord.AttachmentBuilder[]
                    });
                    if(message.createdAt.getTime() - replying_to.createdAt.getTime() < 30 * MINUTE
                    && replying_to.type != Discord.MessageType.ThreadStarterMessage) {
                        await replying_to.delete();
                    }
                    //await message.delete();
                }
            } else {
                message.reply("!f must be used while replying to a message");
            }
        }
    } catch(e) {
        critical_error(e);
        try {
            message.reply("Internal error while replying to !wping");
        } catch(e) {
            critical_error(e);
        }
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && interaction.commandName == "echo") {
        assert(interaction.isChatInputCommand());
        const input = interaction.options.getString("input");
        M.debug("echo command", input);
        await interaction.reply({
            ephemeral: true,
            content: input || undefined
        });
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

export async function setup_format(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
