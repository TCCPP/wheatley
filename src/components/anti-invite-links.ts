import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { BotComponent } from "../bot-component.js";
import { departialize } from "../utils/discord.js";

const INVITE_RE = /(discord(app)?|disboard)\.(gg|(com|org|me)\/(invite|server\/join))\/\S+/i;

export function should_block(content: string) {
    return INVITE_RE.test(content);
}

/**
 * Invite link blocking
 */
export default class AntiInviteLinks extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    async handle_message(message: Discord.Message) {
        if (this.wheatley.is_authorized_mod(message.author)) {
            return;
        }
        if (should_block(message.content)) {
            const quote = await this.wheatley.make_quote_embeds([message]);
            await message.delete();
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
