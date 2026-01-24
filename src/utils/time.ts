import { SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, YEAR } from "../common.js";

export class TimeParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TimeParseError";
    }
}

export function parse_time_unit(u: string): number | null {
    switch (u) {
        case "y":
        case "year":
        case "years":
            return YEAR;
        case "M":
        case "mo":
        case "month":
        case "months":
            return MONTH;
        case "w":
        case "week":
        case "weeks":
            return WEEK;
        case "d":
        case "day":
        case "days":
            return DAY;
        case "h":
        case "hr":
        case "hour":
        case "hours":
            return HOUR;
        case "m":
        case "min":
        case "mins":
        case "minute":
        case "minutes":
            return MINUTE;
        case "s":
        case "sec":
        case "secs":
        case "second":
        case "seconds":
            return SECOND;
        default:
            return null;
    }
}

const duration_re = /^(\d+)\s*(\w+)$/;

export function parse_time_input(input: string): number {
    const trimmed = input.trim();
    const duration_match = trimmed.match(duration_re);
    if (duration_match) {
        const amount = parseInt(duration_match[1]);
        const unit = duration_match[2];
        const factor = parse_time_unit(unit);
        if (factor === null) {
            throw new TimeParseError(`Unknown time unit: ${unit}`);
        }
        return Date.now() + amount * factor;
    }
    const parsed_date = new Date(trimmed);
    if (!isNaN(parsed_date.getTime())) {
        return parsed_date.getTime();
    }
    throw new TimeParseError(
        `Could not parse time. Use a duration (e.g., 30m, 3h, 1d, 1w, 1M, 1y) or ISO date (e.g., 2026-06-01)`,
    );
}
