import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, diff_to_human, floor, round } from "../utils";
import { MINUTE, colors, is_authorized_admin } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

import * as BezierEasing from "bezier-easing";

type scoreboard_entry = {
    tag: string,
    score: number
};

type database_schema = {
    last_reset: number;
    scoreboard: Record<string, number | scoreboard_entry>;
    longest_time_without_reset: number;
}

function dissectDelta(delta: number) {
    let seconds = delta / 1000;
    let minutes = seconds / 60;
    seconds %= 60;
    const hours = minutes / 60;
    minutes %= 60;
    return [ hours, minutes, seconds ];
}

function fmt(n: number, unit: string, p = 0) {
    n = floor(n, p);
    return `${n} ${unit}${n != 1 ? "s" : ""}`;
}

const B = BezierEasing(0.6, 0.35, 0.96, 0.74);

const DAY = 24 * 60 * MINUTE;

const BUTTON_EPOCH = 1675142409000;

export class TheButton extends BotComponent {
    data: database_schema;
    readonly button_message_id = "1069819685786370108";
    button_message: Discord.Message | undefined;
    last_update = {
        epoch: 0,
        timestamp: 0,
        remaining_seconds: 0
    };

    constructor(wheatley: Wheatley) {
        super(wheatley);

        if(!this.wheatley.database.has("the_button")) {
            this.data = {
                last_reset: Date.now(),
                scoreboard: {},
                longest_time_without_reset: 0
            };
            this.update_database();
        } else {
            this.data = this.wheatley.database.get<database_schema>("the_button");
            // fix to add new member
            if(!("longest_time_without_reset" in (this.data as unknown as any))) {
                this.data.longest_time_without_reset = 0;
            }
        }
    }

    make_message(delta: number): Discord.MessageCreateOptions {
        const [ hours, minutes, seconds ] = dissectDelta(delta);
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>()
            .addComponents(
                new Discord.ButtonBuilder()
                    .setCustomId("the-button")
                    .setLabel("The Button")
                    .setStyle(Discord.ButtonStyle.Danger),
                new Discord.ButtonBuilder()
                    .setCustomId("the-button-scoreboard")
                    .setLabel("Scoreboard")
                    .setStyle(Discord.ButtonStyle.Secondary),
                new Discord.ButtonBuilder()
                    .setCustomId("the-button-stats")
                    .setLabel("Stats")
                    .setStyle(Discord.ButtonStyle.Secondary)
            );
        return {
            content: "",
            embeds: [
                new Discord.EmbedBuilder()
                    .setDescription(
                        "The longer it ticks the more points you get.\n\n"
                        + `Time until doomsday: ${fmt(hours, "hour")} ${fmt(minutes, "minute")} `
                        + `(next minute <t:${Math.floor(Date.now() / 1000) + Math.floor(seconds)}:R>)`)
                    .setColor(colors.color)
            ],
            components: [row]
        };
    }

    async update_database() {
        this.wheatley.database.set<database_schema>("the_button", this.data);
        await this.wheatley.database.update();
    }

    time_until_doomsday() {
        const doomsday = this.data.last_reset + DAY;
        const delta = doomsday - Date.now();
        return delta;
    }

    async update_message() {
        const delta = this.time_until_doomsday();
        if(!this.button_message) {
            assert(delta <= 0);
            return;
        }
        if(delta <= 0) {
            // self destruct
            await this.button_message.delete();
            this.button_message = undefined;
            return;
        }
        const [ _hours, _minutes, seconds ] = dissectDelta(delta);
        this.last_update = {
            epoch: this.data.last_reset,
            timestamp: Date.now(),
            remaining_seconds: seconds
        };
        await this.button_message.edit(this.make_message(delta));
    }

    override async on_ready() {
        this.button_message = await this.wheatley.the_button_channel.messages.fetch(this.button_message_id);
        /*const seconds_delta = dissectDelta(this.time_until_doomsday())[2];
        // get ourselves on a 1-minute minute interval
        setTimeout(() => {
            // every minute update
            let waiting = false;
            setInterval(async () => {
                if(waiting) return;
                waiting = true;
                await this.update_message();
                waiting = false;
            }, 60_000);
        }, seconds_delta * 1000);*/
        let waiting = false;
        setInterval(async () => {
            if(this.last_update.epoch != this.data.last_reset
            || Date.now() - this.last_update.timestamp - this.last_update.remaining_seconds * 1000 >= -1500) {
                if(waiting) return;
                waiting = true;
                await this.update_message();
                waiting = false;
            }
        }, 1000);
        // do an update right away
        await this.update_message();
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!wsetupthebutton"
        && is_authorized_admin(message.member!)) {
            await message.channel.send(this.make_message(this.time_until_doomsday()));
            await message.delete();
        }
        if(message.content == "!wresetthebutton"
        && is_authorized_admin(message.member!)) {
            this.data.last_reset = Date.now();
            await this.update_message();
            await this.update_database();
            await message.delete();
        }
        if(message.content == "!wresetthebuttonscoreboard"
        && is_authorized_admin(message.member!)) {
            this.data.scoreboard = {};
            await this.update_database();
            await message.delete();
        }
    }

    get_score(x: number | scoreboard_entry): number {
        return typeof x == "number" ? x : x.score;
    }

    get_scoreboard_entries() {
        return Object.entries(this.data.scoreboard).sort((a, b) => this.get_score(b[1]) - this.get_score(a[1]));
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if(interaction.isButton() && interaction.customId == "the-button") {
            if(interaction.createdTimestamp < this.data.last_reset) {
                await interaction.reply({
                    content: "Your press was received but another button press reached the server first",
                    ephemeral: true
                });
                return;
            }
            const delta = this.time_until_doomsday();
            this.data.last_reset = Date.now() - 1;
            M.debug(`The Button was reset with ${Math.round(delta)} ms until doomsday`,
                    [ interaction.user.id, interaction.user.tag ]);
            const scoreboard = this.data.scoreboard;
            if(!(interaction.user.id in scoreboard)) {
                scoreboard[interaction.user.id] = {
                    tag: interaction.user.tag,
                    score: 0
                };
            }
            // migrate previous mistaken schema
            if(interaction.user.id in scoreboard && typeof scoreboard[interaction.user.id] == "number") {
                scoreboard[interaction.user.id] = {
                    tag: interaction.user.tag,
                    score: scoreboard[interaction.user.id] as number
                };
            }
            this.update_message();
            const time_since_reset = DAY - delta;
            const points = B((time_since_reset) / DAY) * DAY / 1000 / 60;
            const total_score = (scoreboard[interaction.user.id] as scoreboard_entry).score += points;
            this.data.longest_time_without_reset = Math.max(this.data.longest_time_without_reset, time_since_reset);
            const scoreboard_index = this
                .get_scoreboard_entries()
                .findIndex(([ key, _ ]) => key == interaction.user.id);
            await interaction.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setDescription(`Points: ${round(points, 1)}\n`
                            + `Your total score: ${round(total_score, 1)}\n`
                            + `Position on the scoreboard: ${scoreboard_index + 1}`
                        )
                        .setColor(colors.color)
                ],
                ephemeral: true
            });
            await this.update_database();
        }
        if(interaction.isButton() && interaction.customId == "the-button-scoreboard") {
            const scores = this.get_scoreboard_entries().slice(0, 15);
            const embed = new Discord.EmbedBuilder()
                .setTitle("Scoreboard");
            let description = "";
            for(const [ key, value ] of scores) {
                const tag = typeof value == "number" ? `<@${key}>` : value.tag;
                description += `${tag}: ${round(this.get_score(value), 1)}\n`;
            }
            embed.setDescription(description);
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }
        if(interaction.isButton() && interaction.customId == "the-button-stats") {
            const values = Object.values(this.data.scoreboard);
            const total_points_assigned = values.reduce(
                (partial: number, val) => partial + this.get_score(val), 0
            );
            const days = (Date.now() - BUTTON_EPOCH) / DAY;
            const embed = new Discord.EmbedBuilder()
                .setTitle("Scoreboard");
            embed.setDescription(
                `The Button has been up for \`${fmt(days, "day")}\`\n`
                + `Total points collected: \`${round(total_points_assigned, 1)}\`\n`
                + `Players: \`${values.length}\`\n`
                + `Longest time since reset: \`${diff_to_human(this.data.longest_time_without_reset)}\``
            );
            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }
    }
}
