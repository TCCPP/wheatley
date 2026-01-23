import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { DAY, HOUR } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { SelfClearingSet } from "../../../utils/containers.js";

const LLM_REGEX = /\b(?<!!)llms?\b/gi;

const LLM_AUTOREPLY_ENABLED = false;

export default class Autoreply extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    // set of channel ids
    ratelimit = new SelfClearingSet<string>(DAY, HOUR);

    override async on_message_create(message: Discord.Message) {
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (LLM_AUTOREPLY_ENABLED && LLM_REGEX.test(message.content) && !this.ratelimit.has(message.channelId)) {
            this.ratelimit.insert(message.channelId);
            M.log("firing llm auto-reply");
            await message.reply("Did you mean: [***LLVM***](https://llvm.org/)");
        }
        if (
            message.mentions.has(this.wheatley.user.id) &&
            /^(<@\d+>)?\s*is\s*this\s*true\s*\??(<@\d+>)?$/gi.test(message.content)
        ) {
            await message.reply("Depends");
        }
    }
}
