import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

const LLM_REGEX = /\b(?<!!)llms?\b/gi;

const RATELIMIT = 5 * MINUTE;

/**
 * Adds autoreplies
 */
export default class Autoreply extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    last_reply = 0; // ratelimit

    override async on_message_create(message: Discord.Message) {
        if (LLM_REGEX.test(message.content) && Date.now() - this.last_reply >= RATELIMIT) {
            M.log("firing llm auto-reply");
            this.last_reply = Date.now();
            await message.reply("Did you mean: [***LLVM***](https://llvm.org/)");
        }
    }
}
