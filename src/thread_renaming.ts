import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "./utils";
import { colors, rules_channel_id, wheatley_id } from "./common";

let client: Discord.Client;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.MessageEmbed()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

async function on_message(request: Discord.Message) {
    try {
        if(request.author.bot) return; // Ignore bots
        if(request.content.match(/^!rename\s+(.+)/gm)) {
            if(request.channel.isThread()) {
                const thread = request.channel;
                const owner = thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId
                    : (await thread.fetchStarterMessage()).author.id;
                if(owner == request.author.id) {
                    await thread.setName(request.content.substring("!rename".length).trim());
                    //await request.reply({
                    //    embeds: [create_embed(undefined, colors.green, "Success :+1:")]
                    //});
                    //await request.reply({
                    //    content: "Success :+1:"
                    //});
                } else {
                    //await request.reply({
                    //    embeds: [create_embed(undefined, colors.red, "You can only rename threads you own")]
                    //});
                    await request.reply({
                        content: "You can only rename threads you own"
                    });
                }
            } else {
                //await request.reply({
                //    embeds: [create_embed(undefined, colors.red, "You can only rename threads")]
                //});
                await request.reply({
                    content: "You can only rename threads"
                });
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    //if(thread.parentId == rules_channel_id) {
    if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
        return;
    }
    const owner = thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId
        : (await thread.fetchStarterMessage()).author.id;
    await thread.send({
        content: `<@${owner}>`,
        embeds: [create_embed(undefined, colors.red, `Thread created, you are the owner. You can rename the thread with \`!rename <name>\``)]
    });
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_thread_renaming(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
