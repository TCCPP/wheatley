import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { critical_error, M, SelfClearingMap } from "../utils";
import { MINUTE } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

type deletion_target = {
    id: string;
    channel: Discord.TextBasedChannel;
};

export class Deletable extends BotComponent {
    deletion_map = new SelfClearingMap<string, deletion_target>(30 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        if(this.deletion_map.has(message.id)) {
            const { channel, id } = this.deletion_map.get(message.id)!;
            this.deletion_map.remove(message.id)!;
            try {
                await channel.messages.delete(id);
            } catch(e) {}
        }
    }

    make_message_deletable(trigger: Discord.Message, target: Discord.Message) {
        this.deletion_map.set(trigger.id, {
            id: target.id,
            channel: target.channel
        });
    }
}
