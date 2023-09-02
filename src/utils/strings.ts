import * as Discord from "discord.js";
import XXH from "xxhashjs";
import { DAY, HOUR, MINUTE, MONTH, YEAR } from "../common.js";
import { round } from "./misc.js";

export function pluralize(n: number, word: string, round_to: null | number = null) {
    if (n == 1) {
        return `${round_to ? round(n, 2) : n} ${word}`;
    } else {
        return `${round_to ? round(n, 2) : n} ${word}s`;
    }
}

export function time_to_human_core(diff: number, seconds_with_higher_precision = true): string[] {
    if (diff >= YEAR) {
        const years = Math.floor(diff / YEAR);
        return [...(years == 0 ? [] : [pluralize(years, "year", 2)]), ...time_to_human_core(diff % YEAR, false)];
    }
    if (diff >= MONTH) {
        const months = Math.floor(diff / MONTH);
        return [...(months == 0 ? [] : [pluralize(months, "month", 2)]), ...time_to_human_core(diff % MONTH, false)];
    }
    if (diff >= DAY) {
        const days = Math.floor(diff / DAY);
        return [...(days == 0 ? [] : [pluralize(days, "day", 2)]), ...time_to_human_core(diff % DAY, false)];
    }
    if (diff >= HOUR) {
        const hours = Math.floor(diff / HOUR);
        return [...(hours == 0 ? [] : [pluralize(hours, "hour", 2)]), ...time_to_human_core(diff % HOUR, false)];
    }
    if (diff >= MINUTE) {
        const minutes = Math.floor(diff / MINUTE);
        return [
            ...(minutes == 0 ? [] : [pluralize(minutes, "minute", 2)]),
            ...time_to_human_core(diff % MINUTE, seconds_with_higher_precision && true),
        ];
    }
    const seconds = diff / 1000;
    return seconds == 0 ? [] : [pluralize(round(diff / 1000, seconds_with_higher_precision ? 1 : 0), "second", 2)];
}

export function time_to_human(diff: number): string {
    return time_to_human_core(diff).join(" ");
}

const code_re = /`[^`]+`(?!`)/gi;
const code_block_re = /```(?:[^`]|`(?!``))+```/gi;

export function parse_out(message: string) {
    message = message.replace(code_re, message);
    message = message.replace(code_block_re, message);
    return message;
}

export function format_list(items: string[]) {
    if (items.length <= 2) {
        return items.join(" and ");
    } else {
        return `${items.slice(0, items.length - 1).join(", ")}, and ${items[items.length - 1]}`;
    }
}

export function xxh3(message: string) {
    return XXH.h64().update(message).digest().toString(16);
}

// https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
export function escape_regex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function is_string(value: string | unknown): value is string {
    return typeof value === "string" || value instanceof String;
}

export function string_split(str: string, delim: string, limit: number) {
    const parts = str.split(delim);
    if (parts.length > limit) {
        parts.splice(limit - 1, parts.length - limit + 1, parts.slice(limit - 1).join(delim));
    }
    return parts;
}

export function escape_discord(str: string) {
    // Escape <> for mentions, on top of markdown
    return Discord.escapeMarkdown(str).replace(/[<>/]/g, c => `\\${c}`);
}

export function capitalize(str: string) {
    if (str === "") {
        return str;
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function wrap(str: string, thing: string | [string, string]) {
    if (is_string(thing)) {
        return thing + str + thing;
    } else {
        return thing[0] + str + thing[1];
    }
}

// Takes an array of lines and joins them, skips null entries. This is a helper function to make building descriptions
// and conditionally excluding lines more ergonomic
export function build_description(lines: (string | null)[]) {
    return lines.filter(x => x !== null).join("\n");
}
