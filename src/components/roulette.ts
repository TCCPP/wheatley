import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap, SelfClearingSet } from "../utils.js";
import { bot_spam_id, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

const green = 0x31ea6c;
const red = 0xed2d2d;

export type roulette_leaderboard_entry = {
    user: string;
    highscore: number;
};

const LEADERBOARD_ENTRIES = 20;

/**
 * "Russian roulette" game where users risk timing themselves out.
 */
export default class Roulette extends BotComponent {
    readonly warned_users = new SelfClearingSet<string>(60 * MINUTE);
    // user id -> streak count
    readonly streaks = new SelfClearingMap<string, number>(60 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("roulette").set_description("roulette").set_handler(this.roulette.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("leaderboard")
                .set_description("leaderboard")
                .set_handler(this.leaderboard.bind(this)),
        );
    }

    override destroy() {
        super.destroy();
        this.warned_users.destroy();
        this.streaks.destroy();
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
            .setDescription(
                `BANG. <@${author.id}> ${author.tag} [lost](https://www.youtube.com/watch?v=dQw4w9WgXcQ)` +
                    ` [roulette](${command.get_or_forge_url()}) and is being timed out for half an hour` +
                    ` <a:saber:851241060553326652>.\nID: ${author.id}`,
            );
    }

    async update_score(user_id: string) {
        // todo: not efficient at all
        const score = this.streaks.get(user_id)!;
        // add / update entry
        await this.wheatley.database.roulette_leaderboard.updateOne(
            { user: user_id },
            {
                $setOnInsert: {
                    user: user_id,
                },
                $max: {
                    highscore: score,
                },
            },
            { upsert: true },
        );
    }

    async roulette(command: TextBasedCommand) {
        if (command.channel_id != bot_spam_id) {
            await command.reply(`Must be used in <#${bot_spam_id}>`, true);
            return;
        }
        if (this.warned_users.has(command.user.id)) {
            const roll = Math.floor(Math.random() * 6);
            M.log("Received !roulette", command.user.id, command.user.tag, roll);
            if (roll == 0) {
                let ok = true;
                this.streaks.set(command.user.id, 0);
                await this.update_score(command.user.id); // TODO: I forget why this is here
                try {
                    await (await command.get_member()).timeout(30 * MINUTE, "Bang");
                } catch (error) {
                    critical_error("promise failed for timeout of roulette loser", [command.user.id, command.user.tag]);
                    M.error(error);
                    ok = false;
                } finally {
                    // Send bang message
                    const m = { embeds: [this.make_bang_embed(command.user)] };
                    await command.reply(m);
                    await this.wheatley.staff_member_log_channel.send(m);
                    // Setup ban message
                    const ban_embed = this.make_ban_embed(command);
                    if (!ok) {
                        ban_embed.setFooter({
                            text: "Error: Timeout failed ",
                        });
                    }
                    await this.wheatley.staff_member_log_channel.send({ embeds: [ban_embed] });
                }
            } else {
                const m = { embeds: [this.make_click_embed(command.user)] };
                this.streaks.set(command.user.id, (this.streaks.get(command.user.id) ?? 0) + 1);
                await command.reply(m);
                await this.wheatley.staff_member_log_channel.send(m);
                await this.update_score(command.user.id);
            }
        } else {
            await command.reply(
                "Warning: This is __Russian Roulette__. Losing will result in a 30 minute timeout." +
                    " Proceed at your own risk.",
            );
            this.warned_users.insert(command.user.id);
        }
    }

    async leaderboard(command: TextBasedCommand) {
        const embed = new Discord.EmbedBuilder().setColor(green).setTitle("Roulette Leaderboard");
        let description = "";
        const top_scores = <roulette_leaderboard_entry[]>(
            await this.wheatley.database.roulette_leaderboard
                .aggregate([{ $sort: { highscore: -1 } }, { $limit: LEADERBOARD_ENTRIES }])
                .toArray()
        );
        for (const { user, highscore } of top_scores) {
            description += `<@${user}>: ${highscore} roll${highscore == 1 ? "" : "s"} before death\n`;
        }
        embed.setDescription(description);
        await command.reply({ embeds: [embed] });
    }
}
