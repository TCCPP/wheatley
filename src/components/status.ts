import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { critical_error, M } from "../utils";

let client: Discord.Client;

async function on_ready() {
    try {
        client.user?.setActivity({
            name: "C & C++",
            type: Discord.ActivityType.Playing
        });
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_status(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
