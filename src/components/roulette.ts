import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "../utils";
import { bot_spam_id, member_log_channel_id, MINUTE, TCCPP_ID } from "../common";
import { DatabaseInterface } from "../infra/database_interface";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

const green = 0x31ea6c;
const red = 0xed2d2d;

type leaderboard_entry = number;

type leaderboard_schema = {
    // map of user id -> leaderboard_entry
    [key: string]: leaderboard_entry
};

const LEADERBOARD_ENTRIES = 20;

export class Roulette extends BotComponent {
    readonly warned_users = new SelfClearingSet<string>(60 * MINUTE);
    // user id -> streak count
    readonly streaks = new SelfClearingMap<string, number>(60 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        if(!this.wheatley.database.has("roulette_leaderboard")) {
            this.wheatley.database.set<leaderboard_schema>("roulette_leaderboard", {
                /*
                 * map of user id -> leaderboard_entry
                 */
            });
        }
    }

    make_click_embed(author: Discord.User) {
        const streak = (this.streaks.get(author.id) ?? 0) + 1;
        return new Discord.EmbedBuilder()
            .setColor(green)
            .setDescription(`Click. <@${author.id}> got lucky. (Current streak: ${streak})`);
    }

    make_bang_embed(author: Discord.User) {
        return new Discord.EmbedBuilder()
            .setColor(red)
            .setDescription(`BANG. <@${author.id}> is dead <a:saber:851241060553326652>`);
    }

    make_ban_embed(message: Discord.Message) {
        const author = message.author;
        return new Discord.EmbedBuilder()
            .setColor(red)
            .setDescription(`BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`
                          + ` [roulette](${message.url}) and is being timed out for half an hour`
                          + ` <a:saber:851241060553326652>.\nID: ${author.id}`)
            .setFooter({
                text: ""
            });
    }

    async update_scoreboard(user_id: string) {
        // todo: not efficient at all
        const score = this.streaks.get(user_id)!;
        const db = this.wheatley.database.get<leaderboard_schema>("roulette_leaderboard");
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
        this.wheatley.database.set<leaderboard_schema>("roulette_leaderboard", new_db);
        await this.wheatley.database.update();
    }

    async play_roulette(message: Discord.Message) {
        if(message.channel.id != bot_spam_id) {
            message.reply(`Must be used in <#${bot_spam_id}>`);
            return;
        }
        if(this.warned_users.has(message.author.id)) {
            const roll = Math.floor(Math.random() * 6);
            M.log("Received !roulette", message.author.id, message.author.tag, roll);
            if(roll == 0) {
                let ok = true;
                message.member!.timeout(30 * MINUTE, "Bang")
                    .catch((...args: any[]) => {
                        critical_error("promise failed for timeout of roulette loser",
                                       [ message.author.id, message.author.tag ]);
                        M.error(...args);
                        ok = false;
                    })
                    .finally(() => {
                        // Send bang message
                        const m = { embeds: [this.make_bang_embed(message.author)] };
                        message.channel.send(m);
                        this.wheatley.staff_member_log_channel.send(m);
                        // Setup ban message
                        const ban_embed = this.make_ban_embed(message);
                        if(!ok) {
                            ban_embed.setFooter({
                                text: ban_embed.data.footer!.text + "Error: Timeout failed "
                            });
                        }
                        this.wheatley.staff_member_log_channel.send({ embeds: [ban_embed] });
                    });
                this.streaks.set(message.author.id, 0);
                await this.update_scoreboard(message.author.id); // TODO: I forget why this is here
            } else {
                const m = { embeds: [this.make_click_embed(message.author)] };
                this.streaks.set(message.author.id, (this.streaks.get(message.author.id) ?? 0) + 1);
                await message.channel.send(m);
                await this.wheatley.staff_member_log_channel.send(m);
                await this.update_scoreboard(message.author.id);
            }
        } else {
            message.reply("Warning: This is __Russian Roulette__. Losing will result in a 30 minute timeout."
                        + " Proceed at your own risk.");
            this.warned_users.insert(message.author.id);
        }
    }

    async display_leaderboard(message: Discord.Message) {
        const embed = new Discord.EmbedBuilder()
            .setColor(green)
            .setTitle("Roulette Leaderboard");
        let description = "";
        for(const [ key, value ] of
            Object.entries(this.wheatley.database.get<leaderboard_schema>("roulette_leaderboard"))
                .sort((a, b) => b[1] - a[1])) {
            description += `<@${key}>: ${value} roll${value == 1 ? "" : "s"} before death\n`;
        }
        embed.setDescription(description);
        await message.channel.send({ embeds: [embed] });
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!roulette") {
            await this.play_roulette(message);
        } else if(message.content == "!leaderboard") {
            await this.display_leaderboard(message);
        }
    }
}
