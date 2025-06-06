import { strict as assert } from "assert";
import { M } from "./utils/debugging-and-logging.js";

// Duration constants (all ms)
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;
export const YEAR = 365 * DAY;

export enum colors {
    wheatley = 0x337fd5, // blue
    default = 0x7e78fe, // purple TODO: Re-evaluate
    alert_color = 0xf5a53e, // orange
    speedrun_color = 0x0fc644, // red
    red = 0xed2d2d, // red
    green = 0x31ea6c, // green
}
