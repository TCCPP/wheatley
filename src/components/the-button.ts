import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, critical_error, diff_to_human, floor, round } from "../utils.js";
import { MINUTE, colors, is_authorized_admin } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

type scoreboard_entry = {
    tag: string,
    score: number,
    last_press: number
};

type database_schema = {
    last_reset: number;
    scoreboard: Record<string, scoreboard_entry>;
    longest_time_without_reset: number;
    button_presses: number;
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

const F = (x: number) => 2/3 * x + 1/3 * Math.pow(x, 2);

const DAY = 24 * 60 * MINUTE;

const BUTTON_EPOCH = 1675142409000;

const PRESS_TIMEOUT = DAY;

/**
 * Provides "the button" minigame.
 */
export default class TheButton extends BotComponent {
    data: database_schema;
    readonly button_message_id = "1069819685786370108";
    button_message: Discord.Message | undefined;
    last_update = {
        epoch: 0,
        timestamp: 0,
        remaining_seconds: 0
    };
    interval: NodeJS.Timer | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);

        if(!this.wheatley.database.has("the_button")) {
            this.data = {
                last_reset: Date.now(),
                scoreboard: {},
                longest_time_without_reset: 0,
                button_presses: 0
            };
        } else {
            this.data = this.wheatley.database.get<database_schema>("the_button");
            // fix old scoreboard schema
            const scoreboard = this.data.scoreboard as unknown as any;
            for(const key in scoreboard) {
                if(typeof scoreboard[key] == "number") {
                    scoreboard[key] = {
                        tag: "",
                        score: scoreboard[key]
                    };
                }
            }
            // fix to add new member to the scoreboard entries
            for(const key in scoreboard) {
                scoreboard[key].last_press = scoreboard[key].last_press ?? 0;
            }
            // fix to add new member
            if(!("longest_time_without_reset" in (this.data as unknown as any))) {
                this.data.longest_time_without_reset = 0;
            }
            // fix to add new member
            if(!("button_presses" in (this.data as unknown as any))) {
                this.data.button_presses = 3609; // count at time of adding this stat
            }
        }
        this.update_database().catch(critical_error);
    }

    override destroy() {
        super.destroy();
        if(this.interval) clearInterval(this.interval);
    }

    make_message(delta: number): Discord.MessageEditOptions & Discord.MessageCreateOptions {
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
        const points = round(F((DAY - delta) / DAY) * DAY / 1000 / 60, 1);
        const points_next = round(F((DAY - (delta - 1000 * 60)) / DAY) * DAY / 1000 / 60, 1);
        return {
            content: "",
            embeds: [
                new Discord.EmbedBuilder()
                    .setDescription(
                        `Time until doomsday: ${fmt(hours, "hour")} ${fmt(minutes, "minute")} `
                        + `(next minute <t:${Math.floor(Date.now() / 1000) + Math.floor(seconds)}:R>)\n\n`
                        + `Points right now: ${round(points, 1)}\n`
                        + `Points in a minute: ${round(points_next, 1)}`
                    )
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
        let waiting = false;
        this.interval = setInterval(() => {
            if(this.last_update.epoch != this.data.last_reset
            || Date.now() - this.last_update.timestamp - this.last_update.remaining_seconds * 1000 >= -1500) {
                if(waiting) return;
                waiting = true;
                this.update_message().catch(critical_error).finally(() => waiting = false);
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
        if(message.content == "!wadjustscores"
        && is_authorized_admin(message.member!)) {
            const scoreboard = this.data.scoreboard;
            for(const key in scoreboard) {
                scoreboard[key].score *= 2/3;
            }
            await this.update_database();
            await message.delete();
        }
    }

    get_scoreboard_entries() {
        return Object.entries(this.data.scoreboard).sort((a, b) => b[1].score - a[1].score);
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
            // add user to the scoreboard if needed
            const scoreboard = this.data.scoreboard;
            if(!(interaction.user.id in scoreboard)) {
                scoreboard[interaction.user.id] = {
                    tag: interaction.user.tag,
                    score: 0,
                    last_press: 0
                };
            }
            // check to see if the user has pressed it within the last 24 hours
            if(Date.now() - scoreboard[interaction.user.id].last_press <= PRESS_TIMEOUT) {
                // ~~x converts the float x to an integer
                // next_possible is the unix-time for the next possible button press
                const next_possible = ~~((scoreboard[interaction.user.id].last_press + PRESS_TIMEOUT) / 1000);
                await interaction.reply({
                    // string highlighting is screwed, because of the '<' and '>' characters
                    content: `You can press the button again <t:${next_possible}:R>`,
                    ephemeral: true
                });
                return;
            }
            scoreboard[interaction.user.id].last_press = Date.now();
            const delta = this.time_until_doomsday();
            this.data.last_reset = Date.now() - 1;
            M.debug(`The Button was reset with ${Math.round(delta)} ms until doomsday`,
                    [ interaction.user.id, interaction.user.tag ]);
            // Fill in tags as needed, deals with migration from a previous schema
            if(scoreboard[interaction.user.id].tag == "") {
                scoreboard[interaction.user.id].tag = interaction.user.tag;
            }
            await this.update_message();
            const time_since_reset = DAY - delta;
            const points = F(time_since_reset / DAY) * DAY / 1000 / 60;
            scoreboard[interaction.user.id].score += points;
            this.data.longest_time_without_reset = Math.max(this.data.longest_time_without_reset, time_since_reset);
            this.data.button_presses++;
            const scoreboard_index = this
                .get_scoreboard_entries()
                .findIndex(([ key, _ ]) => key == interaction.user.id);
            await interaction.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setDescription(`Points: ${round(points, 1)}\n`
                            + `Your total score: ${round(scoreboard[interaction.user.id].score, 1)}\n`
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
                const tag = value.tag == "" ? `<@${key}>` : value.tag;
                description += `${tag}: ${round(value.score, 1)}\n`;
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
                (partial: number, val) => partial + val.score, 0
            );
            const days = (Date.now() - BUTTON_EPOCH) / DAY;
            const embed = new Discord.EmbedBuilder()
                .setTitle("Stats");
            embed.setDescription(
                `The Button has been up for \`${fmt(days, "day")}\`\n`
                + `Total presses of The Button: \`${this.data.button_presses}\`\n`
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
