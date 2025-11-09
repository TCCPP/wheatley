import * as Discord from "discord.js";

import { RequestInfo, RequestInit } from "node-fetch";
const fetch = (url: RequestInfo, init?: RequestInit) =>
    import("node-fetch").then(({ default: fetch }) => fetch(url, init));

import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";

const MAX_LINES = 12;

type code_link_info =
    | {
          type: "github";
          owner_repo: string;
          branch: string;
          file_path: string;
          start_line: number;
          end_line: number;
      }
    | {
          type: "gist";
          user_gist: string;
          revision: string;
          filename: string;
          start_line: number;
          end_line: number;
      };

type line_range = {
    start: number;
    end: number;
    truncated_end: number;
};

function format_indent(code: string): string {
    const lines = code.replace(/\t/g, "    ").split("\n");
    const non_empty_lines = lines.filter(line => line.trim().length > 0);
    if (non_empty_lines.length === 0) {
        return code;
    }
    const min_indent = Math.min(...non_empty_lines.map(line => line.match(/^(\s*)/)![1].length));
    return lines.map(line => (line.trim().length === 0 ? line : line.substring(min_indent))).join("\n");
}

function get_file_extension(file_path: string): string {
    const parts = file_path.split(".");
    if (parts.length > 1) {
        const extension = parts[parts.length - 1];
        if (extension.match(/^[0-9a-z]+$/i)) {
            return extension;
        }
    }
    return "";
}

function escape_code_backticks(code: string): string {
    return code.replace(/``/g, "`\u200b`");
}

function convert_gist_filename(filename: string): string {
    return filename.replace(/-([^-]*)$/, ".$1");
}

export default class GithubLines extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private readonly github_url_regex =
        // eslint-disable-next-line max-len
        /https?:\/\/github\.com\/([a-zA-Z0-9-_]+\/[A-Za-z0-9_.-]+)\/blob\/(.+?)\/(.+?)#L(\d+)(?:C\d+)?[-~]?L?(\d*)(?:C\d+)?/g;

    private readonly gist_url_regex =
        // eslint-disable-next-line max-len
        /https?:\/\/gist\.github\.com\/([a-zA-Z0-9-_]+\/[0-9a-zA-Z]+)\/?([0-9a-z]*)\/*#file-(.+?)-L(\d+)(?:C\d+)?[-~]?L?(\d*)(?:C\d+)?/g;

    private get_display_name(link_info: code_link_info): string {
        if (link_info.type === "github") {
            return `${link_info.owner_repo}/${link_info.file_path}`;
        } else {
            return `${link_info.user_gist}/${convert_gist_filename(link_info.filename)}`;
        }
    }

    private get_file_name(link_info: code_link_info): string {
        if (link_info.type === "github") {
            return link_info.file_path;
        } else {
            return convert_gist_filename(link_info.filename);
        }
    }

    private build_raw_url(link_info: code_link_info): string {
        if (link_info.type === "github") {
            const { owner_repo, branch, file_path } = link_info;
            return `https://raw.githubusercontent.com/${owner_repo}/${branch}/${file_path}`;
        } else {
            const { user_gist, revision, filename } = link_info;
            const dot_filename = convert_gist_filename(filename);
            if (revision.length > 0) {
                return `https://gist.githubusercontent.com/${user_gist}/raw/${revision}/${dot_filename}`;
            } else {
                return `https://gist.githubusercontent.com/${user_gist}/raw/${dot_filename}`;
            }
        }
    }

    private async fetch_code_file(link_info: code_link_info): Promise<string[] | null> {
        const raw_url = this.build_raw_url(link_info);
        const response = await fetch(raw_url);
        if (!response.ok) {
            const source_type = link_info.type === "github" ? "GitHub" : "Gist";
            M.debug(`Failed to fetch ${source_type} file: ${raw_url} (${response.status})`);
            return null;
        }
        return (await response.text()).split("\n");
    }

    private normalize_line_range(start_line: number, end_line: number): { start: number; end: number } {
        return {
            start: Math.min(start_line, end_line),
            end: Math.max(start_line, end_line),
        };
    }

    private calculate_truncated_range(start: number, end: number, file_length: number): line_range | null {
        if (start > file_length) {
            return null;
        }
        const adjusted_end = Math.min(end, file_length);
        const truncated_end = Math.min(adjusted_end, start + MAX_LINES - 1);
        return { start, end: adjusted_end, truncated_end };
    }

    private extract_lines(lines: string[], start: number, truncated_end: number): string {
        if (start === truncated_end) {
            return lines[start - 1];
        } else {
            return lines.slice(start - 1, truncated_end).join("\n");
        }
    }

    private prepare_code_snippet(lines: string[], range: line_range): string {
        const extracted = this.extract_lines(lines, range.start, range.truncated_end);
        return escape_code_backticks(format_indent(extracted));
    }

    private format_line_info(start: number, truncated_end: number): string {
        return start === truncated_end ? `Line ${start}` : `Lines ${start}-${truncated_end}`;
    }

    private format_truncation_notice(truncated_end: number, adjusted_end: number): string {
        return truncated_end < adjusted_end ? ` (truncated to ${MAX_LINES} lines)` : "";
    }

    private build_snippet_message(file_path: string, range: line_range, code_snippet: string): string {
        const line_info = this.format_line_info(range.start, range.truncated_end);
        const truncation_notice = this.format_truncation_notice(range.truncated_end, range.end);
        return (
            `**${file_path}** (${line_info}${truncation_notice})\n` +
            `\`\`\`${get_file_extension(file_path)}\n${code_snippet}\n\`\`\``
        );
    }

    private async send_snippet_reply(message: Discord.Message, content: string): Promise<void> {
        const reply = await message.reply({
            content,
            allowedMentions: { repliedUser: false, parse: [] },
        });
        this.wheatley.register_non_command_bot_reply(message, reply);
    }

    private parse_code_link(match: RegExpMatchArray, type: "github" | "gist"): code_link_info | null {
        if (type === "github") {
            const [_, owner_repo, branch, file_path, start_str, end_str] = match;
            const start_line = parseInt(start_str, 10);
            const end_line = end_str ? parseInt(end_str, 10) : start_line;
            if (start_line <= 0 || end_line <= 0) {
                return null;
            }
            return {
                type: "github",
                owner_repo,
                branch,
                file_path: decodeURIComponent(file_path),
                start_line,
                end_line,
            };
        } else {
            const [_, user_gist, revision, filename, start_str, end_str] = match;
            const start_line = parseInt(start_str, 10);
            const end_line = end_str ? parseInt(end_str, 10) : start_line;
            if (start_line <= 0 || end_line <= 0) {
                return null;
            }
            return { type: "gist", user_gist, revision, filename: decodeURIComponent(filename), start_line, end_line };
        }
    }

    private async handle_code_link(
        message: Discord.Message,
        match: RegExpMatchArray,
        type: "github" | "gist",
    ): Promise<void> {
        try {
            const link_info = this.parse_code_link(match, type);
            if (!link_info) {
                return;
            }
            const normalized_range = this.normalize_line_range(link_info.start_line, link_info.end_line);
            const display_name = this.get_display_name(link_info);
            M.log(
                "Git lines request",
                message.author.tag,
                message.author.id,
                display_name,
                `L${normalized_range.start}-L${normalized_range.end}`,
                message.url,
            );
            const lines = await this.fetch_code_file(link_info);
            if (!lines) {
                return;
            }
            const range = this.calculate_truncated_range(normalized_range.start, normalized_range.end, lines.length);
            if (!range) {
                return;
            }
            const code_snippet = this.prepare_code_snippet(lines, range);
            const file_name = this.get_file_name(link_info);
            const snippet_message = this.build_snippet_message(file_name, range, code_snippet);
            await this.send_snippet_reply(message, snippet_message);
        } catch (error) {
            M.debug(`Error handling ${type} link:`, error);
        }
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot || message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (!message.mentions.has(this.wheatley.user.id)) {
            return;
        }
        const github_matches = [...message.content.matchAll(this.github_url_regex)].map(match => ({
            match,
            type: "github" as const,
        }));
        const gist_matches = [...message.content.matchAll(this.gist_url_regex)].map(match => ({
            match,
            type: "gist" as const,
        }));
        for (const { match, type } of [...github_matches, ...gist_matches]) {
            await this.handle_code_link(message, match, type);
        }
    }
}
