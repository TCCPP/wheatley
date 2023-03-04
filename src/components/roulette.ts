import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "../utils";
import { bot_spam_id, MINUTE } from "../common";
import { BotComponent } from "../bot-component";
import { Wheatley } from "../wheatley";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command";

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

        this.add_command(
            new TextBasedCommandBuilder("roulette")
                .set_description("roulette")
                .set_handler(this.roulette.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("leaderboard")
                .set_description("leaderboard")
                .set_handler(this.leaderboard.bind(this))
        );
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

    make_ban_embed(command: TextBasedCommand) {
        const author = command.user;
        return new Discord.EmbedBuilder()
            .setColor(red)
            .setDescription(`BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`
                          + ` [roulette](${command.get_or_forge_url()}) and is being timed out for half an hour`
                          + ` <a:saber:851241060553326652>.\nID: ${author.id}`);
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

    async roulette(command: TextBasedCommand) {
        if(command.channel_id != bot_spam_id) {
            await command.reply(`Must be used in <#${bot_spam_id}>`, true);
            return;
        }
        if(this.warned_users.has(command.user.id)) {
            const roll = Math.floor(Math.random() * 6);
            M.log("Received !roulette", command.user.id, command.user.tag, roll);
            if(roll == 0) {
                let ok = true;
                (await command.get_member()).timeout(30 * MINUTE, "Bang")
                    .catch((...args: any[]) => {
                        critical_error("promise failed for timeout of roulette loser",
                                       [ command.user.id, command.user.tag ]);
                        M.error(...args);
                        ok = false;
                    })
                    .finally(() => {
                        // Send bang message
                        const m = { embeds: [this.make_bang_embed(command.user)] };
                        command.reply(m);
                        this.wheatley.staff_member_log_channel.send(m);
                        // Setup ban message
                        const ban_embed = this.make_ban_embed(command);
                        if(!ok) {
                            ban_embed.setFooter({
                                text: "Error: Timeout failed "
                            });
                        }
                        this.wheatley.staff_member_log_channel.send({ embeds: [ban_embed] });
                    });
                this.streaks.set(command.user.id, 0);
                await this.update_scoreboard(command.user.id); // TODO: I forget why this is here
            } else {
                const m = { embeds: [this.make_click_embed(command.user)] };
                this.streaks.set(command.user.id, (this.streaks.get(command.user.id) ?? 0) + 1);
                await command.reply(m);
                await this.wheatley.staff_member_log_channel.send(m);
                await this.update_scoreboard(command.user.id);
            }
        } else {
            command.reply("Warning: This is __Russian Roulette__. Losing will result in a 30 minute timeout."
                        + " Proceed at your own risk.");
            this.warned_users.insert(command.user.id);
        }
    }

    async leaderboard(command: TextBasedCommand) {
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
        await command.reply({ embeds: [embed] });
    }
}
