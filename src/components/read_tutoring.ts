import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { tutoring_id, tutoring_requests_id } from "../common";
import { make_message_deletable } from "./deletable";

let client: Discord.Client;

const color = 0xF34A39;

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.channel.id == tutoring_requests_id) {
            M.log("Sending read tutoring message", message.author.id, message.author.tag, message.url);
            const reply = await message.reply({embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color)
                    .setTitle("Read The Instructions")
                    .setDescription(`Hello :wave:, please read <#${tutoring_id}> and then use /tutoring to request one`
                        + " on one tutoring. Don't hesitate to ask specific questions in our help channels too!")
            ]});
            make_message_deletable(message, reply);
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_read_tutoring(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
