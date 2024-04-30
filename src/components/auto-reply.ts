import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors, DAY, HOUR, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { SelfClearingSet } from "../utils/containers.js";

const LLM_REGEX = /\b(?<!!)llms?\b/gi;

const RATELIMIT = 5 * MINUTE;

/**
 * Adds autoreplies
 */
export default class Autoreply extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    // set of channel ids
    ratelimit = new SelfClearingSet<string>(DAY, HOUR);

    override async on_message_create(message: Discord.Message) {
        if (LLM_REGEX.test(message.content) && !this.ratelimit.has(message.channelId)) {
            this.ratelimit.insert(message.channelId);
            M.log("firing llm auto-reply");
            await message.reply("Did you mean: [***LLVM***](https://llvm.org/)");
        }
    }
}
