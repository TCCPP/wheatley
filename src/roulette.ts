import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "./utils";
import { bot_spam_id, member_log_channel_id, MINUTE, TCCPP_ID } from "./common";
import { DatabaseInterface } from "./database_interface";

let client: Discord.Client;

const warned_users = new SelfClearingSet<string>(60 * MINUTE);

// user id -> number of roles
const streaks = new SelfClearingMap<string, number>(60 * MINUTE);

let database: DatabaseInterface;

type leaderboard_entry = number;

type leaderboard_schema = {
    // map of user id -> leaderboard_entry
    [key: string]: leaderboard_entry
};

const LEADERBOARD_ENTRIES = 20;

let member_log_channel : Discord.TextChannel;

const green = 0x31ea6c;
const red = 0xed2d2d;

function make_click_embed(author: Discord.User) {
    return new Discord.MessageEmbed()
        .setColor(green)
        .setDescription(`Click. <@${author.id}> got lucky. (Current streak: ${(streaks.get(author.id) ?? 0) + 1})`);
}

function make_bang_embed(author: Discord.User) {
    return new Discord.MessageEmbed()
        .setColor(red)
        .setDescription(`BANG. <@${author.id}> is dead <a:saber:851241060553326652>`);
}

function make_ban_embed(message: Discord.Message) {
    const author = message.author;
    return new Discord.MessageEmbed()
        .setColor(red)
        .setDescription(`BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`
                      + ` [roulette](${message.url}) and is being timed out for half an hour`
                      + ` <a:saber:851241060553326652>.\nID: ${author.id}`)
        .setFooter("");
}

async function update_scoreboard(user_id: string) {
    // todo: not efficient at all
    const score = streaks.get(user_id)!;
    const db = database.get<leaderboard_schema>("roulette_leaderboard");
    // add / update entry
    if(!(user_id in db)) {
        db[user_id] = score;
    } else {
        if(score > db[user_id]) {
            db[user_id] = score;
        }
    }
    // trim
    const scores = Object.values(db).sort((a, b) => b - a);
    const cutoff = scores[scores.length < LEADERBOARD_ENTRIES ? scores.length - 1 : LEADERBOARD_ENTRIES - 1];
    const new_db = Object.fromEntries(Object.entries(db).filter(pair => pair[1] >= cutoff));
    database.set<leaderboard_schema>("roulette_leaderboard", new_db);
    await database.update();
}

async function play_roulette(message: Discord.Message) {
    if(message.channel.id != bot_spam_id) {
        message.reply(`Must be used in <#${bot_spam_id}>`);
        return;
    }
    if(warned_users.has(message.author.id)) {
        const roll = Math.floor(Math.random() * 6);
        M.log("!roulette", [message.author.id, message.author.tag], roll);
        if(roll == 0) {
            // Send bang message
            const m = {embeds: [make_bang_embed(message.author)]};
            message.channel.send(m);
            member_log_channel.send(m);
            // Setup ban message
            const ban_embed = make_ban_embed(message);
            const log_msg = await member_log_channel.send({embeds: [ban_embed]});
            message.member!.timeout(30 * MINUTE, "Bang")
                .catch((...args: any[]) => {
                    critical_error("promise failed for timeout of roulette loser",
                                   [message.author.id, message.author.tag]);
                    M.error(...args);
                    ban_embed.setFooter(ban_embed.footer!.text! + "Error: Timeout failed ");
                    log_msg.edit({embeds: [ban_embed]});
                });
            streaks.set(message.author.id, 0);
            await update_scoreboard(message.author.id);
        } else {
            const m = {embeds: [make_click_embed(message.author)]};
            streaks.set(message.author.id, (streaks.get(message.author.id) ?? 0) + 1);
            await message.channel.send(m);
            await member_log_channel.send(m);
            await update_scoreboard(message.author.id);
        }
    } else {
        message.reply("Warning: This is __Russian Roulette__. Losing will result in a 30 minute timeout."
                    + " Proceed at your own risk.");
        warned_users.insert(message.author.id);
    }
}

async function display_leaderboard(message: Discord.Message) {
    const embed = new Discord.MessageEmbed()
        .setColor(green)
        .setTitle("Roulette Leaderboard");
    let description = "";
    for(const [key, value] of
        Object.entries(database.get<leaderboard_schema>("roulette_leaderboard"))
            .sort((a, b) => b[1] - a[1])) {
        description += `<@${key}>: ${value} roll${value == 1 ? "" : "s"} before death\n`;
    }
    embed.setDescription(description);
    await message.channel.send({embeds: [embed]});
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!roulette") {
            await play_roulette(message);
        } else if(message.content == "!leaderboard") {
            await display_leaderboard(message);
        }
    } catch(e) {
        critical_error(e);
        try {
            message.reply("Internal error while handling !roulette");
        } catch(e) {
            critical_error(e);
        }
    }
}

async function on_ready() {
    try {
        const TCCPP = await client.guilds.fetch(TCCPP_ID);
        member_log_channel = (await TCCPP.channels.fetch(member_log_channel_id))! as Discord.TextChannel;
        if(!database.has("roulette_leaderboard")) {
            database.set<leaderboard_schema>("roulette_leaderboard", {
                /*
                 * map of user id -> leaderboard_entry
                 */
            });
        }
        client.on("messageCreate", on_message);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_roulette(_client: Discord.Client, _database: DatabaseInterface) {
    try {
        client = _client;
        database = _database;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
