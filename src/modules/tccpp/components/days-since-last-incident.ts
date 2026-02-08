import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";
import { build_description, capitalize, time_to_human } from "../../../utils/strings.js";
import { colors, DAY, MINUTE } from "../../../common.js";
import { moderation_entry, monke_button_press_entry } from "../../wheatley/components/moderation/schemata.js";
import { set_interval } from "../../../utils/node.js";
import { channel_map } from "../../../channel-map.js";
import { tccpp_channels } from "../channels.js";

const TRACKER_EPOCH = 1705219394732; // 2024-01-14T08:03:14.732Z

const type_labels = {
    ban: "Permanent Ban",
    temp_ban: "Temp Ban",
    kick: "Kick",
    mute: "Mute",
    rolepersist: "Rolepersist",
};

// Block quadrant characters indexed by bitmask: upper_left(8) | upper_right(4) | lower_left(2) | lower_right(1)
const BLOCK_QUADRANTS = [" ", "▗", "▖", "▄", "▝", "▐", "▞", "▟", "▘", "▚", "▌", "▙", "▀", "▜", "▛", "█"];

function get_block_char(upper_left: boolean, upper_right: boolean, lower_left: boolean, lower_right: boolean): string {
    const index = (upper_left ? 8 : 0) | (upper_right ? 4 : 0) | (lower_left ? 2 : 0) | (lower_right ? 1 : 0);
    return BLOCK_QUADRANTS[index];
}

type incident_info = {
    time: string;
    user: string;
    user_name: string;
    type: string;
    type_times: Map<keyof typeof type_labels, string>;
    record_streak: string;
};

export default class DaysSinceLastIncident extends BotComponent {
    message: Discord.Message | null = null;
    last_time = "";
    timer!: NodeJS.Timeout;

    private longest_streak = 0;
    private last_incident_time = 0;

    private channels = channel_map(this.wheatley, tccpp_channels.days_since_last_incident);

    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
        monke_button_presses: monke_button_press_entry;
    }>();

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.wheatley.event_hub.on("issue_moderation", this.handle_incident.bind(this));
    }

    override async setup() {
        await ensure_index(this.wheatley, this.database.monke_button_presses, { timestamp: -1 });

        await this.channels.resolve();
    }

    async get_recent_moderations(): Promise<moderation_entry[]> {
        const cutoff = Date.now() - 100 * DAY;
        return await this.database.moderations
            .find({ type: { $ne: "note" }, issued_at: { $gte: cutoff } })
            .sort({ issued_at: -1 })
            .toArray();
    }

    async get_recent_monke_presses(): Promise<monke_button_press_entry[]> {
        const cutoff = Date.now() - 100 * DAY;
        return await this.database.monke_button_presses
            .find({ timestamp: { $gte: cutoff } })
            .sort({ timestamp: -1 })
            .toArray();
    }

    async initialize_longest_streak() {
        const moderations = await this.database.moderations
            .find({ type: { $ne: "note" }, issued_at: { $gte: TRACKER_EPOCH } })
            .sort({ issued_at: 1 })
            .toArray();
        if (moderations.length === 0) {
            return;
        }
        this.last_incident_time = moderations[moderations.length - 1].issued_at;
        if (moderations.length < 2) {
            return;
        }
        for (let i = 1; i < moderations.length; i++) {
            const gap = moderations[i].issued_at - moderations[i - 1].issued_at;
            if (gap > this.longest_streak) {
                this.longest_streak = gap;
            }
        }
    }

    make_embed(incident: incident_info, moderations: moderation_entry[]) {
        const [count, unit] = incident.time.split(" ");
        const embed = new Discord.EmbedBuilder()
            .setColor(0xefd30a)
            .setDescription(
                build_description(
                    `# \`${count}\` \`${unit}\` since last incident`,
                    `**Last Punishment Type:** ${capitalize(incident.type)}`,
                    `**Record Streak:** \`${incident.record_streak}\``,
                ),
            )
            .addFields({
                name: "Incident Drilldown",
                value: this.format_type_breakdown(incident.type_times),
                inline: false,
            });
        if (moderations.length > 1) {
            embed.addFields(
                {
                    name: "Survival Streaks (Last 30 Days)",
                    value: `\`\`\`\n${this.calculate_time_frequency_histogram(moderations, "issued_at")}\n\`\`\``,
                    inline: false,
                },
                {
                    name: "Latest Scores",
                    value: `\`\`\`\n${this.generate_time_interval_chart(
                        moderations,
                        "issued_at",
                        "← Older          Incidents          Newer →",
                        "No incidents to display",
                    )}\n\`\`\``,
                    inline: false,
                },
            );
        }
        return embed;
    }

    async get_time_since_last_type(type: keyof typeof type_labels): Promise<string | null> {
        const moderation = await this.database.moderations.findOne(this.build_type_query(type), {
            sort: { issued_at: -1 },
        });
        if (moderation) {
            return this.format_time_delta(Date.now() - moderation.issued_at);
        }
        return null;
    }

    async last_incident_info(): Promise<incident_info> {
        const last_incident = await this.database.moderations.findOne(
            { type: { $ne: "note" } },
            { sort: { issued_at: -1 } },
        );
        assert(last_incident);
        const type_times = new Map<keyof typeof type_labels, string>();
        for (const type of Object.keys(type_labels) as (keyof typeof type_labels)[]) {
            const time = await this.get_time_since_last_type(type);
            if (time) {
                type_times.set(type, time);
            }
        }
        const current_streak = Date.now() - last_incident.issued_at;
        const record = Math.max(this.longest_streak, current_streak);
        return {
            time: this.format_time_delta(current_streak),
            user: last_incident.user,
            user_name: last_incident.user_name,
            type: last_incident.type,
            type_times,
            record_streak: time_to_human(record, 2),
        };
    }

    categorize_time_bucket(minutes: number): keyof typeof this.time_buckets {
        if (minutes < 1) {
            return "<1 min";
        } else if (minutes < 5) {
            return "1-5 min";
        } else if (minutes < 15) {
            return "5-15 min";
        } else if (minutes < 60) {
            return "15-60 min";
        } else if (minutes < 360) {
            return "1-6 hrs";
        } else if (minutes < 1440) {
            return "6-24 hrs";
        } else {
            return "1+ day";
        }
    }

    format_time_delta(delta: number): string {
        return delta < MINUTE ? "0 minutes" : time_to_human(delta, 1);
    }

    format_time_styled(delta: number): string {
        const [count, unit] = this.format_time_delta(delta).split(" ");
        return `\`${count}\` \`${unit}\``;
    }

    build_type_query(type: keyof typeof type_labels): object {
        if (type === "ban") {
            return { type: "ban", duration: null };
        } else if (type === "temp_ban") {
            return { type: "ban", duration: { $ne: null } };
        } else {
            return { type };
        }
    }

    format_type_breakdown(type_times: Map<keyof typeof type_labels, string>): string {
        return (Object.entries(type_labels) as [keyof typeof type_labels, string][])
            .map(([type, label]) => {
                const time = type_times.get(type);
                if (time) {
                    const [count, unit] = time.split(" ");
                    return `**${label}: \`${count}\` \`${unit}\`**`;
                } else {
                    return `**${label}: Never**`;
                }
            })
            .join("\n");
    }

    format_date_key(timestamp: number): string {
        const date = new Date(timestamp);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, "0");
        const day = String(date.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private time_buckets = {
        "<1 min": 0,
        "1-5 min": 0,
        "5-15 min": 0,
        "15-60 min": 0,
        "1-6 hrs": 0,
        "6-24 hrs": 0,
        "1+ day": 0,
    };

    calculate_time_frequency_histogram<T extends { timestamp?: number; issued_at?: number }>(
        items: T[],
        timestamp_key: "timestamp" | "issued_at",
    ): string {
        const buckets = { ...this.time_buckets };

        for (let i = 0; i < items.length - 1; i++) {
            const time_between = (items[i][timestamp_key] as number) - (items[i + 1][timestamp_key] as number);
            const minutes = time_between / MINUTE;
            const bucket = this.categorize_time_bucket(minutes);
            buckets[bucket]++;
        }

        const max_count = Math.max(...Object.values(buckets));
        const bar_length = 20;

        return Object.entries(buckets)
            .map(([label, count]) => {
                const filled = Math.round((count / (max_count || 1)) * bar_length);
                const bar = "█".repeat(filled) + "░".repeat(bar_length - filled);
                return `${label.padEnd(10)}: ${bar} ${count}`;
            })
            .join("\n");
    }

    render_bar_chart(
        data: number[],
        title: string,
        bottom_label: string,
        format_y_label: (value: number) => string,
    ): string {
        const chart_rows = 8;
        const units_per_row = 2;
        const chart_height = chart_rows * units_per_row;
        const max_value = Math.max(...data, 1);
        const bar_heights = data.map(v => Math.round((chart_height * v) / max_value));
        const lines: string[] = [title];
        for (let row = 0; row < chart_rows; row++) {
            const row_bottom = (chart_rows - 1 - row) * units_per_row;
            let row_chars = "";
            for (let col = 0; col < data.length; col += 2) {
                const left_height = bar_heights[col];
                const right_height = bar_heights[col + 1] ?? 0;
                row_chars += get_block_char(
                    left_height > row_bottom + 1,
                    right_height > row_bottom + 1,
                    left_height > row_bottom,
                    right_height > row_bottom,
                );
            }
            const y_value = Math.round((max_value * (chart_rows - 1 - row)) / (chart_rows - 1));
            lines.push(`${format_y_label(y_value).padStart(4)} ┤${row_chars}`);
        }
        const char_width = Math.ceil(data.length / 2);
        lines.push(`     ┴${"─".repeat(char_width)}`);
        const padding = " ".repeat(Math.max(0, Math.floor((char_width - bottom_label.length) / 2)));
        lines.push(`      ${padding}${bottom_label}`);
        return lines.join("\n");
    }

    generate_time_interval_chart<T extends { timestamp?: number; issued_at?: number }>(
        items: T[],
        timestamp_key: "timestamp" | "issued_at",
        label_text: string,
        no_data_message: string,
    ): string {
        const max_bars = 100;
        if (items.length === 0) {
            return no_data_message;
        }
        const time_between: number[] = [];
        for (let i = 0; i < items.length - 1; i++) {
            time_between.push(((items[i][timestamp_key] as number) - (items[i + 1][timestamp_key] as number)) / MINUTE);
        }
        const display_data = time_between.slice(0, max_bars).reverse();
        return this.render_bar_chart(display_data, "Time", label_text, value =>
            value >= 60 ? `${Math.floor(value / 60)}h` : `${value}m`,
        );
    }

    get_unique_presses_per_day(presses: monke_button_press_entry[]): { date: string; count: number }[] {
        const presses_by_day = new Map<string, Set<string>>();
        for (const press of presses) {
            const day_key = this.format_date_key(press.timestamp);
            if (!presses_by_day.has(day_key)) {
                presses_by_day.set(day_key, new Set());
            }
            unwrap(presses_by_day.get(day_key)).add(press.user);
        }
        return Array.from(presses_by_day.entries())
            .map(([date, users]) => ({ date, count: users.size }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    calculate_average_presses_per_day(daily_data: { date: string; count: number }[]): number {
        if (daily_data.length === 0) {
            return 0;
        }
        const total = daily_data.reduce((sum, day) => sum + day.count, 0);
        return total / daily_data.length;
    }

    generate_presses_per_day_chart(daily_data: { date: string; count: number }[]): string {
        const max_bars = 100;
        if (daily_data.length === 0) {
            return "No press data to display";
        }
        const display_data = daily_data.slice(-max_bars).map(d => d.count);
        return this.render_bar_chart(display_data, "Presses", "← Older      Days      Newer →", value =>
            value.toString(),
        );
    }

    analyze_historical_trend(daily_data: { date: string; count: number }[]): string {
        if (daily_data.length < 4) {
            return "Insufficient data for trend analysis";
        }
        const midpoint = Math.floor(daily_data.length / 2);
        const older_total = daily_data.slice(0, midpoint).reduce((sum, day) => sum + day.count, 0);
        const recent_total = daily_data.slice(midpoint).reduce((sum, day) => sum + day.count, 0);
        const older_avg = older_total / midpoint;
        const recent_avg = recent_total / (daily_data.length - midpoint);
        const change = recent_avg - older_avg;
        const percent_change = older_avg > 0 ? ((change / older_avg) * 100).toFixed(1) : "N/A";
        if (Math.abs(change) < 0.5) {
            return `**Trend:** Stable (${recent_avg.toFixed(1)} presses/day)`;
        } else if (change > 0) {
            return `**Trend:** Increasing ↑ (+${change.toFixed(1)} presses/day, +${percent_change}%)`;
        } else {
            return `**Trend:** Decreasing ↓ (${change.toFixed(1)} presses/day, ${percent_change}%)`;
        }
    }

    format_monke_statistics(total: number, unique: number, average: number, trend: string): string {
        return [
            `**Total Presses (All Time):** ${total.toLocaleString("en-US")}`,
            `**Unique Users (All Time):** ${unique.toLocaleString("en-US")}`,
            `**Average Unique Presses/Day (Last 40 Days):** ${average.toFixed(2)}`,
            trend,
        ].join("\n");
    }

    async make_monke_embed() {
        const last_press = await this.database.monke_button_presses.findOne({}, { sort: { timestamp: -1 } });
        const recent_presses = await this.get_recent_monke_presses();
        const total_presses = await this.database.monke_button_presses.countDocuments();
        const unique_users = (
            await this.database.monke_button_presses.aggregate([{ $group: { _id: "$user" } }]).toArray()
        ).length;
        const daily_data = this.get_unique_presses_per_day(recent_presses);
        const description = last_press
            ? build_description(
                  `# ${this.format_time_styled(Date.now() - last_press.timestamp)} since last monke press`,
              )
            : "# No monke button presses recorded";
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setDescription(description)
            .addFields({
                name: "Monke Button Statistics",
                value: this.format_monke_statistics(
                    total_presses,
                    unique_users,
                    this.calculate_average_presses_per_day(daily_data),
                    this.analyze_historical_trend(daily_data),
                ),
                inline: false,
            });
        if (daily_data.length > 0) {
            embed.addFields({
                name: "Unique Presses Per Day (Last 40 Days)",
                value: `\`\`\`\n${this.generate_presses_per_day_chart(daily_data)}\n\`\`\``,
                inline: false,
            });
        }
        return embed;
    }

    async build_embeds(): Promise<Discord.EmbedBuilder[]> {
        const info = await this.last_incident_info();
        this.last_time = info.time;
        const moderations = await this.get_recent_moderations();
        return [this.make_embed(info, moderations), await this.make_monke_embed()];
    }

    async update_if_changed() {
        const info = await this.last_incident_info();
        if (info.time !== this.last_time) {
            await unwrap(this.message).edit({ embeds: await this.build_embeds() });
        }
    }

    override async on_ready() {
        await this.initialize_longest_streak();
        const messages = (await this.channels.days_since_last_incident.messages.fetch()).filter(
            message => message.author.id == this.wheatley.user.id,
        );
        assert(messages.size <= 1);
        if (messages.size == 1) {
            this.message = unwrap(messages.first());
            await this.update_if_changed();
        } else {
            this.message = await this.channels.days_since_last_incident.send({ embeds: await this.build_embeds() });
        }
        this.timer = set_interval(() => {
            this.update_if_changed().catch(this.wheatley.critical_error.bind(this.wheatley));
        }, MINUTE);
    }

    handle_incident(moderation: moderation_entry) {
        if (moderation.type === "note") {
            return;
        }
        if (this.last_incident_time > 0) {
            const gap = moderation.issued_at - this.last_incident_time;
            if (gap > this.longest_streak) {
                this.longest_streak = gap;
            }
        }
        this.last_incident_time = moderation.issued_at;
        this.update_if_changed().catch(this.wheatley.critical_error.bind(this.wheatley));
    }
}
