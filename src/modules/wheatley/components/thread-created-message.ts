import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";

export default class ThreadCreatedMessage extends BotComponent {
    override async on_message_create(message: Discord.Message) {
        if (message.type == Discord.MessageType.ThreadCreated) {
            //M.log(message);
            //assert(message.channel instanceof Discord.TextChannel);
            //const thread = await fetch_thread_channel(message.channel, unwrap(message.reference).channelId);
            //M.log(thread, thread.parentId);
            if (unwrap(message.reference).channelId != message.id) {
                M.debug("Deleting thread created message");
                await message.delete();
            }
        }
    }
}
