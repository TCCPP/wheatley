import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { RequestInfo, RequestInit } from "node-fetch";
const fetch = (url: RequestInfo, init?: RequestInit) =>
    import("node-fetch").then(({ default: fetch }) => fetch(url, init));

import { async_exec_file, critical_error, M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuCommandBuilder } from "../command.js";
import { MINUTE } from "../common.js";

const color = 0x7E78FE; //0xA931FF;

const clang_format_path = "/usr/bin/clang-format";

const max_attachment_size = 1024 * 10;

// highlight js accepts all
const languages = [
    "1c", "4d", "abnf", "accesslog", "actionscript", "ada", "adoc", "alan", "angelscript", "apache", "apacheconf",
    "applescript", "arcade", "arduino", "arm", "armasm", "as", "asc", "asciidoc", "aspectj", "atom", "autohotkey",
    "autoit", "avrasm", "awk", "axapta", "bash", "basic", "bat", "bbcode", "bf", "bind", "blade", "bnf", "brainfuck",
    "c", "c++", "cal", "capnp", "capnproto", "cc", "chaos", "chapel", "chpl", "cisco", "clj", "clojure", "cls",
    "cmake.in", "cmake", "cmd", "coffee", "coffeescript", "console", "coq", "cos", "cpc", "cpp", "cr", "craftcms",
    "crm", "crmsh", "crystal", "cs", "csharp", "cshtml", "cson", "csp", "css", "cxx", "cypher", "d", "dart", "delphi",
    "dfm", "diff", "django", "dns", "docker", "dockerfile", "dos", "dpr", "dsconfig", "dst", "dts", "dust", "dylan",
    "ebnf", "elixir", "elm", "erl", "erlang", "excel", "extempore", "f90", "f95", "fix", "fortran", "freepascal", "fs",
    "fsharp", "gams", "gauss", "gawk", "gcode", "gdscript", "gemspec", "gf", "gherkin", "glimmer", "glsl", "gms", "gn",
    "gni", "go", "godot", "golang", "golo", "gololang", "gradle", "graph", "groovy", "gss", "gyp", "h", "h++", "haml",
    "handlebars", "haskell", "haxe", "hbs", "hbs", "hcl", "hh", "hlsl", "hpp", "hs", "html.handlebars",
    "html.handlebars", "html.hbs", "html.hbs", "html", "htmlbars", "http", "https", "hx", "hxx", "hy", "hylang", "i",
    "i7", "iced", "iecst", "inform7", "ini", "ino", "instances", "iol", "irb", "irpf90", "java", "javascript", "jinja",
    "jolie", "js", "json", "jsp", "jsx", "julia-repl", "julia", "k", "kaos", "kdb", "kotlin", "kt", "lasso",
    "lassoscript", "lazarus", "ldif", "leaf", "lean", "less", "lfm", "lisp", "livecodeserver", "livescript", "ln",
    "lpr", "ls", "ls", "lua", "mak", "make", "makefile", "markdown", "mathematica", "matlab", "mawk", "maxima", "md",
    "mel", "mercury", "mirc", "mizar", "mk", "mkd", "mkdown", "ml", "ml", "mm", "mma", "mojolicious", "monkey", "moon",
    "moonscript", "mrc", "n1ql", "nawk", "nc", "never", "nginx", "nginxconf", "nim", "nimrod", "nix", "nsis", "obj-c",
    "obj-c++", "objc", "objective-c++", "objectivec", "ocaml", "ocl", "ol", "openscad", "osascript", "oxygene", "p21",
    "papyrus", "parser3", "pas", "pascal", "patch", "pcmk", "perl", "pf.conf", "pf", "pgsql", "php", "php3", "php4",
    "php5", "php6", "php7", "php8", "pl", "plaintext", "plist", "pm", "podspec", "pony", "postgres", "postgresql",
    "powershell", "pp", "processing", "profile", "prolog", "properties", "protobuf", "ps", "ps1", "psc", "puppet", "py",
    "pycon", "python-repl", "python", "qml", "qsharp", "r", "razor-cshtml", "razor", "rb", "re", "reasonml", "rebol",
    "red-system", "red", "redbol", "rf", "rib", "risc", "riscript", "robot", "rpm-spec", "rpm-specfile", "rpm", "rs",
    "rsl", "rss", "ruby", "ruleslanguage", "rust", "sas", "SAS", "sc", "scad", "scala", "scheme", "sci", "scilab",
    "scl", "scss", "sh", "shell", "shexc", "smali", "smalltalk", "sml", "sol", "solidity", "spec", "specfile", "spl",
    "sql", "st", "stan", "stanfuncs", "stata", "step", "stl", "stp", "structured-text", "styl", "stylus", "subunit",
    "supercollider", "svelte", "svg", "swift", "tao", "tap", "tcl", "terraform", "tex", "text", "tf", "thor", "thrift",
    "tk", "toml", "tp", "ts", "tsql", "twig", "txt", "typescript", "unicorn-rails-log", "v", "vala", "vb", "vba",
    "vbnet", "vbs", "vbscript", "verilog", "vhdl", "vim", "wl", "x++", "x86asm", "xhtml", "xjb", "xl", "xls", "xlsx",
    "xml", "xpath", "xq", "xquery", "xsd", "xsl", "xtlang", "xtm", "yaml", "yml", "zenscript", "zep", "zephir", "zone",
    "zs", "zsh"
];

const c_cpp_language_codes = new Set([ "c", "h", "cpp", "hpp", "cc", "hh", "cxx", "cxx", "c++", "h++" ]);

const languages_re = new RegExp(
    languages
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
    "void",
    "bool",
    "unsigned",
    "long",
];

const code_begin_re = new RegExp(code_begin.join("|"));

const code_block_re = new RegExp(`(\`\`\`(?:${languages_re.source}\b)?)(.*?)\`\`\``, "gims");

const default_clang_format_language = "cpp";

const ignore_prefixes = [ ";compile", ";asm" ];

async function clang_format(text: string, args: string[]) {
    const { stdout, stderr } = await async_exec_file(clang_format_path, args, {}, text);
    if(stderr.toString("utf8").trim().length != 0) {
        M.debug("Clang format stderr", stderr.toString("utf8"));
        // TODO: Ping zelis?
    }
    return stdout.toString("utf8");
}

const clang_format_style = [
    "BasedOnStyle: Chromium",
    "IndentWidth: 2",
    "SpacesInAngles: false",
    "SpaceAfterTemplateKeyword: false"
];

const clang_format_style_embed = [
    ...clang_format_style,
    "ColumnLimit: 48",
    "AlignAfterOpenBracket: AlwaysBreak"
];

export async function clang_format_embed_code(text: string) {
    return await clang_format(text, [`-style={${clang_format_style_embed.join(", ")}}`]);
}

export async function clang_format_general(text: string) {
    return await clang_format(text, [`-style={${clang_format_style.join(", ")}}`]);
}

// https://stackoverflow.com/questions/12568097/how-can-i-replace-a-string-by-range
function replace_range(s: string, start: number, end: number, substitute: string) {
    return s.substring(0, start) + substitute + s.substring(end);
}

async function format(replying_to: Discord.Message) {
    let content = replying_to.content;
    // does the message have code blocks?
    const code_blocks: {language: string, content: string}[] = [];
    content = content.replaceAll(code_block_re, (_, starter: string, block: string) => {
        const language = starter.length > 3 ? starter.substring(3) : "cpp";
        code_blocks.push({ language, content: block });
        return `<[<[<[<[${code_blocks.length - 1}]>]>]>]>`;
    });
    // else ...
    if(code_blocks.length == 0) {
        const start = content.search(code_begin_re);
        if(start > -1) {
            const end = Math.max(...[...";}"].map(c => content.lastIndexOf(c)));
            if(end > start) {
                code_blocks.push({
                    language: default_clang_format_language,
                    content: content.substring(start, end + 1)
                });
                content = replace_range(content, start, end + 1, `<[<[<[<[${code_blocks.length - 1}]>]>]>]>`);
            }
        }
    }

    for(const [ i, block ] of code_blocks.entries()) {
        if(c_cpp_language_codes.has(block.language)) {
            content = content.replace(`<[<[<[<[${i}]>]>]>]>`, `\`\`\`${block.language}\n${
                await clang_format_general(block.content)
            }\n\`\`\``);
        } else {
            // don't format, just put it back
            content = content.replace(`<[<[<[<[${i}]>]>]>]>`, `\`\`\`${block.language}\n${block.content}\n\`\`\``);
        }
    }

    // does the message have attachments?
    const attachments = await Promise.all([...replying_to.attachments.values()]
        .filter(attachment => attachment.contentType?.startsWith("text/") ?? false)
        .filter(attachment => attachment.size < max_attachment_size)
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

    return { content, attachments, found_code_blocks: code_blocks.length > 0 };
}

function should_replace_original(replying_to: Discord.Message, request_timestamp: Date) {
    return request_timestamp.getTime() - replying_to.createdAt.getTime() < 30 * MINUTE
        && replying_to.id != replying_to.channel.id // Don't delete if it's a forum thread starter message
        && !replying_to.flags.has(Discord.MessageFlags.HasThread)
        && replying_to.attachments.size <= 2 // Also don't delete if it has additional/non-txt attachments
        && !replying_to.attachments.some(({ contentType }) => contentType?.startsWith("text/") ?? false)
    // and not a ;compile, ;asm, or other bot command
        && !ignore_prefixes.some(prefix => replying_to.content.startsWith(prefix));
}

/**
 * Adds formatting commands.
 *
 * Freestanding.
 */
export class Format extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new MessageContextMenuCommandBuilder("Format")
                .set_handler(this.format_ctxmenu.bind(this))
        );
    }

    // TODO: More refactoring needed

    override async on_message_create(message: Discord.Message) {
        // TODO: Leaving for now, need better way to handle this in the general case. Will probably be part of a larger
        // command abstraction
        try {
            if(message.author.bot) return; // Ignore bots
            if(message.content == "!f" || message.content == "!format") {
                if(message.type == Discord.MessageType.Reply) {
                    const replying_to = await message.fetchReference();

                    M.log(`Received ${message.content}`, message.author.tag, message.author.id, replying_to.url);

                    if(replying_to.author.bot) {
                        const reply = await message.reply("Can't format a bot message");
                        this.wheatley.make_deletable(message, reply);
                        return;
                    }

                    const { content, attachments, found_code_blocks } = await format(replying_to);

                    if(attachments.length || found_code_blocks) {
                        const embed = new Discord.EmbedBuilder()
                            .setColor(color)
                            .setAuthor({
                                name: replying_to.member?.displayName ?? replying_to.author.tag,
                                iconURL: replying_to.member?.avatarURL() ?? replying_to.author.displayAvatarURL()
                            });
                        if(message.author.id != replying_to.author.id) {
                            embed.setFooter({
                                text: `Formatted by ${message.member?.displayName ?? message.author.tag}`,
                                iconURL: message.author.displayAvatarURL()
                            });
                        }
                        const formatted_message = await message.channel.send({
                            embeds: [embed],
                            content,
                            files: attachments.filter(x => x != null) as Discord.AttachmentBuilder[],
                            allowedMentions: {
                                parse: ["users"]
                            }
                        });
                        if(should_replace_original(replying_to, message.createdAt)) {
                            await replying_to.delete();
                        } else {
                            this.wheatley.make_deletable(message, formatted_message);
                        }
                    } else {
                        const reply = await message.reply("Nothing to format");
                        this.wheatley.make_deletable(message, reply);
                    }
                } else {
                    const reply = await message.reply("!f must be used while replying to a message");
                    this.wheatley.make_deletable(message, reply);
                }
            }
        } catch(e) {
            critical_error(e);
            try {
                message.reply("Internal error while running !f");
            } catch(e) {
                critical_error(e);
            }
        }
    }

    async format_ctxmenu(interaction: Discord.MessageContextMenuCommandInteraction) {
        const replying_to = interaction.targetMessage;

        M.debug("Received format command", interaction.user.tag, interaction.user.id, replying_to.url);

        if(replying_to.author.bot) {
            await interaction.reply({
                content: "Can't format a bot message",
                ephemeral: true
            });
            return;
        }

        // Out of caution
        // It might already be the case users can't use context menu commands on messages in channels they don't
        // have permissions for
        const channel = await interaction.guild!.channels.fetch(interaction.channelId);
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        assert(channel);
        if(!channel.permissionsFor(member).has(Discord.PermissionsBitField.Flags.SendMessages)) {
            await interaction.reply({
                content: "You don't have permissions here.",
                ephemeral: true
            });
            return;
        }

        const { content, attachments, found_code_blocks } = await format(replying_to);

        if(attachments.length || found_code_blocks) {
            let embeds: Discord.EmbedBuilder[] | undefined;
            if(interaction.user.id != replying_to.author.id) {
                embeds = [
                    new Discord.EmbedBuilder()
                        .setColor(color)
                        .setAuthor({
                            name: replying_to.member?.displayName ?? replying_to.author.tag,
                            iconURL: replying_to.member?.avatarURL() ?? replying_to.author.displayAvatarURL()
                        })
                ];
            }
            await interaction.reply({
                embeds,
                content,
                files: attachments.filter(x => x != null) as Discord.AttachmentBuilder[],
                allowedMentions: {
                    parse: ["users"]
                }
            });
            if(should_replace_original(replying_to, interaction.createdAt)) {
                await replying_to.delete();
            }
        } else {
            await interaction.reply({
                content: "Nothing to format",
                ephemeral: true
            });
        }
    }
}
