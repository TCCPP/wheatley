import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { critical_error, M, SelfClearingMap } from "../utils";
import { is_authorized_admin, MINUTE } from "../common";

let client: Discord.Client;

const color = 0x7E78FE; //0xA931FF;

type deletion_target = {
    id: string;
    channel: Discord.TextBasedChannel;
};

// deletion trigger -> deletion target
let deletion_map = new SelfClearingMap<string, deletion_target>(30 * MINUTE);

async function on_message_delete(message: Discord.Message | Discord.PartialMessage) {
    try {
        M.debug("Message delete", message);
        if(deletion_map.has(message.id)) {
            const {channel, id} = deletion_map.get(message.id)!;
            deletion_map.remove(message.id)!;
            channel.messages.delete(id);
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
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
