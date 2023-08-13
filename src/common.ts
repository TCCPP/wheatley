import { strict as assert } from "assert";
import { M } from "./utils.js";

// Common constants
export const MINUTE = 1000 * 60;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MONTH = 30 * DAY;
export const YEAR = 365 * DAY;

export enum colors {
    wheatley = 0x337fd5,
    alert_color = 0xf5a53e,
    speedrun_color = 0x0fc644,
    red = 0xed2d2d,
    green = 0x31ea6c,
}
