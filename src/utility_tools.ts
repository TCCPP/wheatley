import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { is_authorized_admin, TCCPP_ID } from "./common";

let client: Discord.Client;

async function on_message(message: Discord.Message) {
    if(message.author.bot) return; // Ignore bots
    if(is_authorized_admin(message.author)) {
        try {
            if(message.content == "!channel-rename") {
                M.info("got !channel-rename");
                let m = await message.channel.send("working...");
                let TCCPP = await client.guilds.fetch(TCCPP_ID);
                let channels = await TCCPP.channels.fetch();
                for(let [_, channel] of channels) {
                    let r = channel.name.replace(/_/g, "-");
                    M.info("Renaming", channel.name, r);
                    await channel.setName(r);
                }
                M.info("Done");
                m.edit(":+1:");
            }
        } catch(e) {
            critical_error(e);
            try {
                await message.reply("Internal error");
            } catch(e) {
                critical_error(e);
            }
        }
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_utility_tools(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
