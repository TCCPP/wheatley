import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { critical_error, M, SelfClearingMap } from "../utils";
import { MINUTE } from "../common";

let client: Discord.Client;

type deletion_target = {
    id: string;
    channel: Discord.TextBasedChannel;
};

// deletion trigger -> deletion target
let deletion_map: SelfClearingMap<string, deletion_target>;

async function on_message_delete(message: Discord.Message | Discord.PartialMessage) {
    try {
        if(deletion_map.has(message.id)) {
            const {channel, id} = deletion_map.get(message.id)!;
            deletion_map.remove(message.id)!;
            try {
                await channel.messages.delete(id);
            } catch(e) {}
        }
    } catch(e) {
        critical_error(e);
    }
}

export function make_message_deletable(trigger: Discord.Message, target: Discord.Message) {
    deletion_map.set(trigger.id, {
        id: target.id,
        channel: target.channel
    });
}

async function on_ready() {
    try {
        client.on("messageDelete", on_message_delete);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_deletable(_client: Discord.Client) {
    try {
        client = _client;
        // This needs to be initialized in the setup function. The create index scripts indirectly import this and the
        // timer needs to not be running.
        deletion_map = new SelfClearingMap(30 * MINUTE);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
