import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { RequestInfo, RequestInit } from "node-fetch";
const fetch = (url: RequestInfo, init?: RequestInit) =>
    import("node-fetch").then(({ default: fetch }) => fetch(url, init));

import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { MINUTE } from "../common.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { async_exec_file } from "../utils/filesystem.js";
import { markdown_node, MarkdownParser, CodeBlockRule, InlineCodeRule, TextRule } from "dismark";
import { Mutex } from "../utils/containers.js";
import { send_long_message_markdown_aware, send_long_response_markdown_aware } from "../utils/discord.js";
import Help from "./help.js";

const color = 0x7e78fe; //0xA931FF;

const code_only_parser = new MarkdownParser([new CodeBlockRule(), new InlineCodeRule(), new TextRule()]);

const clang_format_path = "/usr/bin/clang-format";

const max_attachment_size = 1024 * 10;

const c_cpp_language_codes = new Set(["c", "h", "cpp", "hpp", "cc", "hh", "cxx", "cxx", "c++", "h++"]);

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
    "void",
    "bool",
    "unsigned",
    "long",
];

function word_boundary(regex: string) {
    if (regex.length > 0 && /\w/.test(regex[0])) {
        regex = "\\b" + regex;
    }
    if (regex.length > 0 && /\w/.test(regex[regex.length - 1])) {
        regex += "\\b";
    }
    return regex;
}

const code_begin_re = new RegExp(`(?:${code_begin.map(word_boundary).join("|")})`);

const default_clang_format_language = "cpp";

const ignore_prefixes = [";compile", ";asm"];

const clang_format_mutex = new Mutex();

async function clang_format(text: string, args: string[]): Promise<string> {
    try {
        await clang_format_mutex.lock(); // This is a ratelimiting mechanism
        const { stdout, stderr } = await async_exec_file(clang_format_path, args, {}, text);
        if (stderr.toString("utf8").trim().length != 0) {
            M.debug("Clang format stderr", stderr.toString("utf8"));
            // TODO: Ping zelis?
        }
        return stdout.toString("utf8");
    } finally {
        clang_format_mutex.unlock();
    }
}

const clang_format_style = [
    "BasedOnStyle: Chromium",
    "IndentWidth: 2",
    "SpacesInAngles: false",
    "SpaceAfterTemplateKeyword: false",
];

const clang_format_style_embed = [...clang_format_style, "ColumnLimit: 48", "AlignAfterOpenBracket: AlwaysBreak"];

export async function clang_format_embed_code(text: string) {
    return await clang_format(text, [`-style={${clang_format_style_embed.join(", ")}}`]);
}

export async function clang_format_general(text: string) {
    return await clang_format(text, [`-style={${clang_format_style.join(", ")}}`]);
}

async function format_message_content(ast: markdown_node): Promise<{ content: string; found_code: boolean }> {
    let found_code = false;

    const format_node = async (node: markdown_node): Promise<string> => {
        switch (node.type) {
            case "doc":
                return (await Promise.all(node.content.map(format_node))).join("");
            case "code_block": {
                found_code = true;
                const language = node.language ?? default_clang_format_language;
                if (c_cpp_language_codes.has(language)) {
                    const formatted = await clang_format_general(node.content);
                    return `\`\`\`${node.language ?? ""}\n${formatted}\n\`\`\``;
                } else {
                    return `\`\`\`${node.language ?? ""}\n${node.content}\n\`\`\``;
                }
            }
            case "inline_code":
                return `\`${node.content}\``;
            case "plain": {
                const code_start = node.content.search(code_begin_re);
                if (code_start > -1) {
                    const end = Math.max(...[...";}"].map(c => node.content.lastIndexOf(c)));
                    if (end > code_start) {
                        found_code = true;
                        const code_content = node.content.substring(code_start, end + 1);
                        const formatted = await clang_format_general(code_content);
                        return (
                            node.content.substring(0, code_start) +
                            `\`\`\`${default_clang_format_language}\n${formatted}\n\`\`\`` +
                            node.content.substring(end + 1)
                        );
                    }
                }
                return node.content;
            }
            default:
                throw new Error(`Unknown ast node ${(node as markdown_node).type}`);
        }
    };

    const content = await format_node(ast);
    return { content, found_code };
}

async function format(replying_to: Discord.Message) {
    const ast = code_only_parser.parse(replying_to.content);
    const { content, found_code } = await format_message_content(ast);

    const attachments = await Promise.all(
        [...replying_to.attachments.values()]
            .filter(attachment => attachment.contentType?.startsWith("text/") ?? false)
            .filter(attachment => attachment.size < max_attachment_size)
            .slice(0, 2) // at most 2 attachments
            .map(async attachment => {
                const fetch_response = await fetch(attachment.url);
                if (fetch_response.ok) {
                    const text = await fetch_response.text();
                    return new Discord.AttachmentBuilder(Buffer.from(await clang_format_general(text)), {
                        name: `${attachment.name}.cpp`,
                    });
                } else {
                    return null;
                }
            }),
    );

    return {
        content,
        attachments,
        found_code_blocks: found_code,
    };
}

function should_replace_original(replying_to: Discord.Message, request_timestamp: Date) {
    return (
        request_timestamp.getTime() - replying_to.createdAt.getTime() < 30 * MINUTE &&
        replying_to.id != replying_to.channel.id && // Don't delete if it's a forum thread starter message
        !replying_to.flags.has(Discord.MessageFlags.HasThread) &&
        replying_to.attachments.size <= 2 && // Also don't delete if it has additional/non-txt attachments
        !replying_to.attachments.some(({ contentType }) => contentType?.startsWith("text/") ?? false) &&
        // and not a ;compile, ;asm, or other bot command
        !ignore_prefixes.some(prefix => replying_to.content.startsWith(prefix))
    );
}

export default class Format extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(new MessageContextMenuInteractionBuilder("Format").set_handler(this.format_ctxmenu.bind(this)));

        const help = this.wheatley.components.get("Help") as Help | undefined;
        help?.add_category_content("Utility", "`!f <reply>` Format the message being replied to");
    }

    // TODO: More refactoring needed

    override async on_message_create(message: Discord.Message) {
        // TODO: Leaving for now, need better way to handle this in the general case. Will probably be part of a larger
        // command abstraction
        try {
            // Ignore bots
            if (message.author.bot) {
                return;
            }
            if (message.content == "!f" || message.content == "!format") {
                if (message.type == Discord.MessageType.Reply) {
                    const replying_to = await message.fetchReference();

                    M.log(`Received ${message.content}`, message.author.tag, message.author.id, replying_to.url);

                    if (replying_to.author.bot) {
                        const reply = await message.reply("Can't format a bot message");
                        this.wheatley.register_non_command_bot_reply(message, reply);
                        return;
                    }

                    const { content, attachments, found_code_blocks } = await format(replying_to);

                    if (attachments.length || found_code_blocks) {
                        const embed = new Discord.EmbedBuilder().setColor(color).setAuthor({
                            name: replying_to.member?.displayName ?? replying_to.author.tag,
                            iconURL: replying_to.member?.avatarURL() ?? replying_to.author.displayAvatarURL(),
                        });
                        if (message.author.id != replying_to.author.id) {
                            embed.setFooter({
                                text: `Formatted by ${message.member?.displayName ?? message.author.tag}`,
                                iconURL: message.author.displayAvatarURL(),
                            });
                        }
                        assert(!(message.channel instanceof Discord.PartialGroupDMChannel));

                        const formatted_message = await send_long_message_markdown_aware(message.channel, content, {
                            embeds: [embed],
                            files: attachments.filter(x => x != null),
                            allowedMentions: {
                                parse: ["users"],
                            },
                        });

                        if (should_replace_original(replying_to, message.createdAt)) {
                            await replying_to.delete();
                        } else if (formatted_message) {
                            this.wheatley.register_non_command_bot_reply(message, formatted_message);
                        }
                    } else {
                        const reply = await message.reply("Nothing to format");
                        this.wheatley.register_non_command_bot_reply(message, reply);
                    }
                } else {
                    const reply = await message.reply("!f must be used while replying to a message");
                    this.wheatley.register_non_command_bot_reply(message, reply);
                }
            }
        } catch (e) {
            this.wheatley.critical_error(e);
            try {
                await message.reply("Internal error while running !f");
            } catch (e) {
                this.wheatley.critical_error(e);
            }
        }
    }

    async format_ctxmenu(interaction: Discord.MessageContextMenuCommandInteraction) {
        const replying_to = interaction.targetMessage;

        M.debug("Received format command", interaction.user.tag, interaction.user.id, replying_to.url);

        if (replying_to.author.bot) {
            await interaction.reply({
                content: "Can't format a bot message",
                ephemeral: true,
            });
            return;
        }

        // Out of caution
        // It might already be the case users can't use context menu commands on messages in channels they don't
        // have permissions for
        const channel = await interaction.guild!.channels.fetch(interaction.channelId);
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        assert(channel);
        if (!channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.SendMessages)) {
            await interaction.reply({
                content: "You don't have permissions here.",
                ephemeral: true,
            });
            return;
        }

        const { content, attachments, found_code_blocks } = await format(replying_to);

        if (attachments.length || found_code_blocks) {
            let embeds: Discord.EmbedBuilder[] | undefined;
            if (interaction.user.id != replying_to.author.id) {
                embeds = [
                    new Discord.EmbedBuilder().setColor(color).setAuthor({
                        name: replying_to.member?.displayName ?? replying_to.author.tag,
                        iconURL: replying_to.member?.avatarURL() ?? replying_to.author.displayAvatarURL(),
                    }),
                ];
            }

            await send_long_response_markdown_aware(interaction, content, false, {
                embeds,
                files: attachments.filter(x => x != null),
                allowedMentions: {
                    parse: ["users"],
                },
            });

            if (should_replace_original(replying_to, interaction.createdAt)) {
                await replying_to.delete();
            }
        } else {
            await interaction.reply({
                content: "Nothing to format",
                ephemeral: true,
            });
        }
    }
}
