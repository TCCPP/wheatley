import { M } from "../../utils/debugging-and-logging.js";
import { unwrap } from "../../utils/misc.js";

export function strip_parentheses(title: string, opening: string, closing: string) {
    const parentheses_stack: number[] = [];
    for (let i = 0; i < title.length; i++) {
        if (title[i] == opening) {
            parentheses_stack.push(i);
        } else if (title[i] == closing) {
            if (parentheses_stack.length > 0) {
                const start = unwrap(parentheses_stack.pop());
                if (title.substring(0, start).match(/\boperator(?!.+::)\b/)) {
                    // for operator declarations, pass
                    // cases like
                    // operator==, !=, <, <=, >, >=, <=>(std::optional)
                    // std::expected<t,e>::operator->, std::expected<t,e>::operator*
                } else if (title.substring(start + 1, i) == "bool") {
                    // skip
                    // TODO: Temporary hack for std::vector<bool>
                } else {
                    title = title.slice(0, start) + title.slice(i + 1);
                    i = start - 1; // i will be incremented next
                }
            }
        }
    }
    return title.trim();
}

export function normalize_and_sanitize_title(title: string) {
    title = title.toLowerCase();
    title = title.replace(/\([^)]*c(\+\+)?\d+\)/g, ""); // (since c++20), (deprecated in c++98), (c++11), etc...
    title = title.replace(/\([^)]+ ts\)/g, "");
    title = title.replace(/\(removed\)/g, "");
    title = title.trim();
    title = title.replace(/\s+/, " ");
    if (!title.startsWith("standard library header")) {
        title = strip_parentheses(title, "<", ">");
    }
    return title.trim();
}

export function smart_split_list(title: string) {
    const splits = [];
    let parentheses_depth = 0;
    let split_start = 0;
    for (let i = 0; i < title.length; i++) {
        if (title[i] == "(") {
            parentheses_depth++;
        } else if (title[i] == ")") {
            parentheses_depth--;
        } else if (title[i] == ",") {
            if (parentheses_depth == 0) {
                splits.push(title.substring(split_start, i));
                split_start = i + 1;
            } else {
                // ignore
            }
        }
    }
    if (split_start < title.length) {
        splits.push(title.substring(split_start));
    }
    return splits.map(s => s.trim());
}

export function split_cppref_title_list(title: string) {
    // TODO: Code probably needs to be cleaned up a lot
    if (title.match(/\boperator\b/)) {
        // take a case like
        // operator==, !=, <, <=, >, >=, <=>(std::optional)
        // try to split it into operator==(std::optional), operator!=(std::optional), ... etc.
        // the one pitfall here is taking something like std::atomic<T>::operator++,++(int),--,--(int) and making all
        // entries operator++(int) but that's perfectly fine for search purposes
        const parts = smart_split_list(title);
        const operator_parts = new Set(
            parts
                .map(p => p.match(/^.*\boperator\b/))
                .filter(o => o != null)
                .map(m => m[0]),
        );
        const args_parts = new Set(
            parts
                .map(p => p.match(/(?<!operator)\s*\(.*\)$/))
                .filter(o => o != null)
                .map(m => m[0]),
        );
        // sorting by size because of cases like
        // std::experimental::filesystem::directory_iterator::operator*,operator->
        // operator_parts will be "std::experimental::filesystem::directory_iterator::operator" and "operator", take the
        // first
        const operator_part = operator_parts.size ? [...operator_parts].sort((a, b) => b.length - a.length)[0] : null;
        const args_part = args_parts.size ? [...args_parts].sort((a, b) => b.length - a.length)[0] : null;
        const corrected_parts = parts.map(part => {
            if (operator_part && !part.startsWith(operator_part)) {
                // handle cases like std::coroutine_handle<promise>::operator(), std::coroutine_handle<promise>::resume
                if (!part.startsWith("std::")) {
                    part = operator_part + part;
                }
            }
            if (args_part && !part.endsWith(args_part)) {
                part = part + args_part;
            }
            return part;
        });
        return corrected_parts;
    } else {
        const parts = smart_split_list(title);
        // try to correct stuff like std::erase, std::erase_if (std::deque)
        const args_parts = new Set(
            parts
                .map(p => p.match(/\s*\(.*\)$/))
                .filter(o => o != null)
                .map(m => m[0]),
        );
        const args_part = args_parts.size ? [...args_parts].sort((a, b) => b.length - a.length)[0] : null;
        const corrected_parts = parts.map(part => {
            if (args_part && !part.endsWith(args_part)) {
                if (part.match(/\s*\(.*\)$/)) {
                    M.warn("more than one parameter set in title", part);
                }
                part = part + args_part;
            }
            return part;
        });
        return corrected_parts;
    }
}

export function normalize_and_split_cppref_title(title: string) {
    if (title.match(/\bbasic_/g)) {
        // basic_string::xyz -> string::xyz, etc.
        const alt_title = title.replace(/\bbasic_/g, "");
        return [
            ...split_cppref_title_list(normalize_and_sanitize_title(title)),
            ...split_cppref_title_list(normalize_and_sanitize_title(alt_title)),
        ];
    } else {
        return split_cppref_title_list(normalize_and_sanitize_title(title));
    }
}
