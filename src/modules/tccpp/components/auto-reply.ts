import * as Discord from "discord.js";

import { M } from "../../../utils/debugging-and-logging.js";
import { DAY, HOUR } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { channel_map } from "../../../channel-map.js";
import { wheatley_channels } from "../../wheatley/channels.js";

const LLM_REGEX = /\b(?<!!)llms?\b/gi;
const MICROSLOP_REGEX = /\b(?<!!)(?<![./])microsoft?\b/gi;

const LLM_AUTOREPLY_ENABLED = false;
const MICROSLOP_AUTOREPLY_ENABLED = true;
const RATELIMIT_DURATION = 1 * DAY;
const RATELIMIT_PROBABILITY = 0.2;

export default class Autoreply extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private channels = channel_map(this.wheatley, wheatley_channels.bot_spam);

    last_reply_time = Date.now() + RATELIMIT_DURATION; // Hedge against restarts

    override async setup() {
        await this.channels.resolve();
    }

    is_ratelimited() {
        return Date.now() - this.last_reply_time < RATELIMIT_DURATION;
    }

    override async on_message_create(message: Discord.Message) {
        if (message.guildId !== this.wheatley.guild.id || message.author.bot) {
            return;
        }
        if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            LLM_AUTOREPLY_ENABLED &&
            LLM_REGEX.test(message.content) &&
            !this.is_ratelimited() &&
            Math.random() <= RATELIMIT_PROBABILITY &&
            message.channel.id !== this.channels.bot_spam.id
        ) {
            this.last_reply_time = Date.now();
            M.log("firing llm auto-reply");
            await message.reply({
                content: "Did you mean: [***LLVM***](https://llvm.org/)",
                allowedMentions: { repliedUser: false },
            });
        }
        if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            MICROSLOP_AUTOREPLY_ENABLED &&
            MICROSLOP_REGEX.test(message.content) &&
            !this.is_ratelimited() &&
            Math.random() <= RATELIMIT_PROBABILITY &&
            message.channel.id !== this.channels.bot_spam.id &&
            message.author.id !== "1000654924591403108"
        ) {
            this.last_reply_time = Date.now();
            M.log("firing microslop auto-reply");
            await message.reply({
                content: "Did you mean: [***Microslop***](<https://microslop.com/>)",
                allowedMentions: { repliedUser: false },
            });
        }
        if (
            message.mentions.has(this.wheatley.user.id) &&
            /^(<@\d+>)?\s*is\s*this\s*true\s*\??(<@\d+>)?$/gi.test(message.content)
        ) {
            await message.reply("Depends");
        }
    }
}
