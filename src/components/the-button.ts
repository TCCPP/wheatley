import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { floor, round, unwrap } from "../utils/misc.js";
import { time_to_human } from "../utils/strings.js";
import { critical_error } from "../utils/debugging-and-logging.js";
import { M } from "../utils/debugging-and-logging.js";
import { DAY, MINUTE, colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { button_scoreboard_entry } from "../infra/schemata/the-button.js";
import { set_interval } from "../utils/node.js";

function dissectDelta(delta: number) {
    let seconds = delta / 1000;
    let minutes = seconds / 60;
    seconds %= 60;
    const hours = minutes / 60;
    minutes %= 60;
    return [hours, minutes, seconds];
}

function fmt(n: number, unit: string, p = 0) {
    n = floor(n, p);
    return `${n} ${unit}${n != 1 ? "s" : ""}`;
}

// points, as a function of milliseconds since the last press
function F(ms: number) {
    const minutes = ms / 1000 / 60;
    let sum = 0;
    for (let i = 0; i < minutes; i++) {
        sum += 1440 / (1440 - i);
    }
    return sum;
}

const BUTTON_EPOCH = 1675142409000;

const PRESS_TIMEOUT = DAY;

/**
 * Provides "the button" minigame.
 */
export default class TheButton extends BotComponent {
    readonly button_message_id = "1205725580578787368";
    button_message: Discord.Message | undefined;
    last_update = {
        epoch: 0,
        timestamp: 0,
        remaining_seconds: 0,
    };
    interval: NodeJS.Timeout | null = null;

    button_presses: number;
    last_reset: number;
    longest_time_without_reset: number;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    make_message(time_until_doomsday: number): Discord.MessageEditOptions & Discord.MessageCreateOptions {
        const [hours, minutes, seconds] = dissectDelta(time_until_doomsday);
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
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
                .setStyle(Discord.ButtonStyle.Secondary),
        );
        const points = round(F(DAY - time_until_doomsday), 1);
        const points_next = round(F(DAY - time_until_doomsday + MINUTE), 1);
        return {
            content: "",
            embeds: [
                new Discord.EmbedBuilder()
                    .setDescription(
                        `Time until doomsday: ${fmt(hours, "hour")} ${fmt(minutes, "minute")} ` +
                            `(next minute <t:${Math.floor(Date.now() / 1000) + Math.floor(seconds)}:R>)\n\n` +
                            `Points right now: ${round(points, 1)}\n` +
                            `Points in a minute: ${round(points_next, 1)}`,
                    )
                    .setColor(colors.wheatley),
            ],
            components: [row],
        };
    }

    async update_message() {
        const time_since_last_reset = Date.now() - this.last_reset;
        const time_until_doomsday = Math.max(0, DAY - time_since_last_reset);
        if (!this.button_message) {
            assert(time_until_doomsday <= 0);
            return;
        }
        if (time_until_doomsday <= 0) {
            // self destruct
            await this.button_message.delete();
            this.button_message = undefined;
            return;
        }
        const [_hours, _minutes, seconds] = dissectDelta(time_until_doomsday);
        this.last_update = {
            epoch: this.last_reset,
            timestamp: Date.now(),
            remaining_seconds: seconds,
        };
        await this.button_message.edit(this.make_message(time_until_doomsday));
    }

    override async on_ready() {
        const bot_data = await this.wheatley.database.get_bot_singleton();
        this.button_presses = bot_data.the_button.button_presses;
        this.last_reset = bot_data.the_button.last_reset;
        this.longest_time_without_reset = bot_data.the_button.longest_time_without_reset;

        this.button_message = await this.wheatley.channels.the_button.messages.fetch(this.button_message_id);
        let waiting = false;
        this.interval = set_interval(() => {
            if (
                this.last_update.epoch != this.last_reset ||
                Date.now() - this.last_update.timestamp - this.last_update.remaining_seconds * 1000 >= -1500
            ) {
                if (waiting) {
                    return;
                }
                waiting = true;
                this.update_message()
                    .catch(critical_error)
                    .finally(() => (waiting = false));
            }
        }, 1000);
        // do an update right away
        await this.update_message();
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots
        if (message.author.bot) {
            return;
        }
        if (message.content == "!wsetupthebutton" && this.wheatley.is_authorized_mod(message.member!)) {
            const time_since_last_reset = Date.now() - this.last_reset;
            const time_until_doomsday = Math.max(0, DAY - time_since_last_reset);
            await message.channel.send(this.make_message(time_until_doomsday));
            await message.delete();
        }
        if (message.content == "!wresetthebutton" && this.wheatley.is_authorized_mod(message.member!)) {
            this.last_reset = Date.now();
            await this.update_message();
            await this.update_metadata();
            await message.delete();
        }
        if (message.content == "!wresetthebuttonscoreboard" && this.wheatley.is_authorized_mod(message.member!)) {
            await this.wheatley.database.button_scoreboard.deleteMany({});
            await message.delete();
        }
        if (message.content == "!wadjustscores" && this.wheatley.is_authorized_mod(message.member!)) {
            await this.wheatley.database.button_scoreboard.updateMany(
                {},
                {
                    $mul: {
                        score: 2 / 3,
                    },
                },
            );
            await message.delete();
        }
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isButton() && interaction.customId == "the-button") {
            if (interaction.createdTimestamp < this.last_reset) {
                await interaction.reply({
                    content: "Your press was received but another button press reached the server first",
                    ephemeral: true,
                });
                return;
            }
            // it might take a moment to go through everything
            await interaction.deferReply({
                ephemeral: true,
            });
            // add user to the scoreboard if needed
            const entry = await this.wheatley.database.button_scoreboard.findOne({ user: interaction.user.id });
            // check to see if the user has pressed it within the last 24 hours
            if (entry && Date.now() - entry.last_press <= PRESS_TIMEOUT) {
                // ~~x converts the float x to an integer
                // next_possible is the unix-time for the next possible button press
                const next_possible = ~~((entry.last_press + PRESS_TIMEOUT) / 1000);
                await interaction.editReply({
                    // string highlighting is screwed, because of the '<' and '>' characters
                    content: `You can press the button again <t:${next_possible}:R>`,
                });
                return;
            }
            const time_since_last_reset = Date.now() - this.last_reset;
            const time_until_doomsday = Math.max(0, DAY - time_since_last_reset);
            this.last_reset = Date.now() - 1;
            const points = F(time_since_last_reset);
            M.debug(
                `The Button was reset with ${Math.round(time_until_doomsday)} ms until doomsday ` +
                    `for ${points} points`,
                [interaction.user.id, interaction.user.tag],
            );
            await this.update_message();
            const res = unwrap(
                await this.wheatley.database.button_scoreboard.findOneAndUpdate(
                    {
                        user: interaction.user.id,
                    },
                    {
                        $setOnInsert: {
                            user: interaction.user.id,
                        },
                        $set: {
                            tag: interaction.user.tag,
                            last_press: Date.now(),
                        },
                        $inc: {
                            score: points,
                            presses: 1,
                        },
                    },
                    {
                        upsert: true,
                        returnDocument: "after",
                    },
                ),
            );
            this.longest_time_without_reset = Math.max(this.longest_time_without_reset, time_since_last_reset);
            this.button_presses++;
            const scoreboard_index = await this.wheatley.database.button_scoreboard.countDocuments({
                score: { $gt: res.score },
            });
            await interaction.editReply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setDescription(
                            `Points: ${round(points, 1)}\n` +
                                `Your total score: ${round(res.score, 1)}\n` +
                                `Position on the scoreboard: ${scoreboard_index + 1}`,
                        )
                        .setColor(colors.wheatley),
                ],
            });
            await this.update_metadata();
        }
        if (interaction.isButton() && interaction.customId == "the-button-scoreboard") {
            const scores = (await this.wheatley.database.button_scoreboard
                .aggregate([{ $sort: { score: -1 } }, { $limit: 15 }])
                .toArray()) as button_scoreboard_entry[];
            const embed = new Discord.EmbedBuilder().setTitle("Scoreboard").setColor(colors.wheatley);
            let description = "";
            for (const entry of scores) {
                const tag = entry.tag == "" ? `<@${entry.user}>` : entry.tag;
                description += `${tag}: ${round(entry.score, 1)}\n`;
            }
            // If user exists in the scoreboard, show their score.
            const current_user = await this.wheatley.database.button_scoreboard.findOne({ user: interaction.user.id });
            if (current_user != null) {
                description += `\n\nYour Current score: ${round(current_user.score, 1)}`;
            }
            embed.setDescription(description);
            await interaction.reply({
                embeds: [embed],
                ephemeral: true,
            });
        }
        if (interaction.isButton() && interaction.customId == "the-button-stats") {
            const count = await this.wheatley.database.button_scoreboard.countDocuments();
            const total_points_assigned = (
                await this.wheatley.database.button_scoreboard
                    .aggregate([
                        {
                            $group: {
                                _id: null,
                                total: {
                                    $sum: "$score",
                                },
                            },
                        },
                    ])
                    .toArray()
            )[0].total as number;
            const days = (Date.now() - BUTTON_EPOCH) / DAY;
            const embed = new Discord.EmbedBuilder().setTitle("Stats").setColor(colors.wheatley);
            embed.setDescription(
                `The Button has been up for \`${fmt(days, "day")}\`\n` +
                    `Total presses of The Button: \`${this.button_presses}\`\n` +
                    `Total points collected: \`${round(total_points_assigned, 1)}\`\n` +
                    `Players: \`${count}\`\n` +
                    `Longest time since reset: \`${time_to_human(this.longest_time_without_reset)}\``,
            );
            await interaction.reply({
                embeds: [embed],
                ephemeral: true,
            });
        }
    }

    async update_metadata() {
        await this.wheatley.database.update_bot_singleton({
            the_button: {
                button_presses: this.button_presses,
                last_reset: this.last_reset,
                longest_time_without_reset: this.longest_time_without_reset,
            },
        });
    }
}
