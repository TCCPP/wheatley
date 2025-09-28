import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { floor, round, unwrap } from "../../../utils/misc.js";
import { time_to_human } from "../../../utils/strings.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { DAY, MINUTE, colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { set_interval } from "../../../utils/node.js";
import { discord_timestamp } from "../../../utils/discord.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { ButtonInteractionBuilder, BotButton } from "../../../command-abstractions/button.js";

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

type the_button_state = {
    id: "the_button";
    button_presses: number;
    last_reset: number;
    longest_time_without_reset: number;
};

type the_button_scoreboard_entry = {
    user: string;
    tag: string;
    score: number;
    presses: number;
    last_press: number;
    legacy_score: number;
};

export default class TheButton extends BotComponent {
    readonly button_message_id = "1205725580578787368";
    button_message: Discord.Message | undefined;
    last_update = {
        epoch: 0,
        timestamp: 0,
        remaining_seconds: 0,
    };
    interval: NodeJS.Timeout | null = null;

    button_presses!: number;
    last_reset!: number;
    longest_time_without_reset!: number;

    private the_button_channel!: Discord.TextChannel;

    private the_button_button!: BotButton<[]>;
    private the_button_scoreboard_button!: BotButton<[]>;
    private the_button_stats_button!: BotButton<[]>;

    private database = this.wheatley.database.create_proxy<{
        component_state: the_button_state;
        button_scoreboard: the_button_scoreboard_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        this.the_button_channel = await this.utilities.get_channel(this.wheatley.channels.the_button);

        commands.add(
            new TextBasedCommandBuilder("wsetupthebutton", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Setup The Button here")
                .set_slash(false)
                .set_handler(this.button_setup.bind(this)),
        );
        commands.add(
            new TextBasedCommandBuilder("wresetthebutton", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Reset The Button")
                .set_slash(false)
                .set_handler(this.button_reset.bind(this)),
        );
        commands.add(
            new TextBasedCommandBuilder("wresetthebuttonscoreboard", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Reset The Button scoreboard")
                .set_slash(false)
                .set_handler(this.button_reset_scoreboard.bind(this)),
        );
        commands.add(
            new TextBasedCommandBuilder("wadjustscores", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Adjust The Button scores")
                .set_slash(false)
                .set_handler(this.button_adjust_scores.bind(this)),
        );

        this.the_button_button = commands.add(
            new ButtonInteractionBuilder("the-button").set_handler(this.the_button_press.bind(this)),
        );
        this.the_button_scoreboard_button = commands.add(
            new ButtonInteractionBuilder("the-button-scoreboard").set_handler(
                this.the_button_scoreboard_press.bind(this),
            ),
        );
        this.the_button_stats_button = commands.add(
            new ButtonInteractionBuilder("the-button-stats").set_handler(this.the_button_stats_press.bind(this)),
        );
    }

    private async button_setup(command: TextBasedCommand) {
        const time_since_last_reset = Date.now() - this.last_reset;
        const time_until_doomsday = Math.max(0, DAY - time_since_last_reset);
        assert(command.channel && !(command.channel instanceof Discord.PartialGroupDMChannel));
        this.button_message = await command.channel.send(this.make_message(time_until_doomsday));
    }

    private async button_reset(command: TextBasedCommand) {
        this.last_reset = Date.now();
        await this.update_message();
        await this.update_metadata();
    }

    private async button_reset_scoreboard(command: TextBasedCommand) {
        await this.database.button_scoreboard.deleteMany({});
    }

    private async button_adjust_scores(command: TextBasedCommand) {
        await this.database.button_scoreboard.updateMany(
            {},
            {
                $mul: {
                    score: 2 / 3,
                },
            },
        );
    }

    make_message(time_until_doomsday: number): Discord.MessageEditOptions & Discord.MessageCreateOptions {
        const [hours, minutes, seconds] = dissectDelta(time_until_doomsday);
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.the_button_button.create_button().setLabel("The Button").setStyle(Discord.ButtonStyle.Danger),
            this.the_button_scoreboard_button
                .create_button()
                .setLabel("Scoreboard")
                .setStyle(Discord.ButtonStyle.Secondary),
            this.the_button_stats_button.create_button().setLabel("Stats").setStyle(Discord.ButtonStyle.Secondary),
        );
        const points = round(F(DAY - time_until_doomsday), 1);
        const points_next = round(F(DAY - time_until_doomsday + MINUTE), 1);
        return {
            content: "",
            embeds: [
                new Discord.EmbedBuilder()
                    .setDescription(
                        `Time until doomsday: ${fmt(hours, "hour")} ${fmt(minutes, "minute")} ` +
                            `(next minute ${discord_timestamp(Date.now() + seconds * 1000, "R")})\n\n` +
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
        const state = await this.database.component_state.findOne({ id: "the_button" });
        this.button_presses = state?.button_presses ?? 0;
        this.last_reset = state?.last_reset ?? Date.now();
        this.longest_time_without_reset = state?.longest_time_without_reset ?? 0;

        this.button_message = await this.the_button_channel.messages.fetch(this.button_message_id);
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
                    .catch(this.wheatley.critical_error.bind(this.wheatley))
                    .finally(() => (waiting = false));
            }
        }, 1000);
        // do an update right away
        await this.update_message();
    }

    async the_button_press(interaction: Discord.ButtonInteraction) {
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
        const entry = await this.database.button_scoreboard.findOne({ user: interaction.user.id });
        // check to see if the user has pressed it within the last 24 hours
        if (entry && Date.now() - entry.last_press <= PRESS_TIMEOUT) {
            await interaction.editReply({
                content: "You can press the button again " + discord_timestamp(entry.last_press + PRESS_TIMEOUT, "R"),
            });
            return;
        }
        const time_since_last_reset = Date.now() - this.last_reset;
        const time_until_doomsday = Math.max(0, DAY - time_since_last_reset);
        this.last_reset = Date.now() - 1;
        const points = F(time_since_last_reset);
        M.debug(
            `The Button was reset with ${Math.round(time_until_doomsday)} ms until doomsday ` + `for ${points} points`,
            [interaction.user.id, interaction.user.tag],
        );
        await this.update_message();
        const res = unwrap(
            await this.database.button_scoreboard.findOneAndUpdate(
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
        const scoreboard_index = await this.database.button_scoreboard.countDocuments({
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

    async the_button_scoreboard_press(interaction: Discord.ButtonInteraction) {
        const scores = (await this.database.button_scoreboard
            .aggregate([{ $sort: { score: -1 } }, { $limit: 15 }])
            .toArray()) as the_button_scoreboard_entry[];
        const embed = new Discord.EmbedBuilder().setTitle("Scoreboard").setColor(colors.wheatley);
        let description = "";
        for (const entry of scores) {
            const tag = entry.tag == "" ? `<@${entry.user}>` : entry.tag;
            description += `${tag}: ${round(entry.score, 1)}\n`;
        }
        // If user exists in the scoreboard, show their score.
        const current_user = await this.database.button_scoreboard.findOne({ user: interaction.user.id });
        if (current_user != null) {
            description += `\n\nYour Current score: ${round(current_user.score, 1)}`;
        }
        embed.setDescription(description);
        await interaction.reply({
            embeds: [embed],
            ephemeral: true,
        });
    }

    async the_button_stats_press(interaction: Discord.ButtonInteraction) {
        const count = await this.database.button_scoreboard.countDocuments();
        const total_points_assigned = (
            await this.database.button_scoreboard
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

    async update_metadata() {
        await this.database.component_state.updateOne(
            { id: "the_button" },
            {
                $set: {
                    button_presses: this.button_presses,
                    last_reset: this.last_reset,
                    longest_time_without_reset: this.longest_time_without_reset,
                },
            },
            { upsert: true },
        );
    }
}
