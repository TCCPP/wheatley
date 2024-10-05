import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { BotComponent } from "../bot-component.js";
import { departialize } from "../utils/discord.js";

const INVITE_RE =
    /(?:(?:discord(?:app)?|disboard)\.(?:gg|(?:com|org|me)\/(?:invite|server\/join))|(?<!\w)\.gg)\/(\S+)/i;

const whitelist = [
    "tccpp",
    "python",
    "csharp",
    "bVTPVpYVcv", // cuda
    "Eb7P3wH", // graphics
];

export function match_invite(content: string): string | null {
    const match = content.match(INVITE_RE);
    return match ? match[1] : null;
}

export default class AntiInviteLinks extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    async handle_message(message: Discord.Message) {
        if (this.wheatley.is_authorized_mod(message.author)) {
            return;
        }
        const match = match_invite(message.content);
        if (match && !whitelist.includes(match)) {
            const quote = await this.wheatley.make_quote_embeds([message]);
            await message.delete();
            assert(!(message.channel instanceof Discord.PartialGroupDMChannel));
            await message.channel.send(`<@${message.author.id}> Please do not send invite links`);
            await this.wheatley.channels.staff_flag_log.send({
                content: `:warning: Invite link deleted`,
                ...quote,
            });
        }
    }

    override async on_message_create(message: Discord.Message) {
        await this.handle_message(message);
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        await this.handle_message(await departialize(new_message));
    }
}
