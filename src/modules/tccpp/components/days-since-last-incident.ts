import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";
import { build_description, capitalize, time_to_human } from "../../../utils/strings.js";
import { colors, DAY, MINUTE } from "../../../common.js";
import {
    moderation_entry,
    moderation_type,
    monke_button_press_entry,
} from "../../../components/moderation/schemata.js";
import { set_interval } from "../../../utils/node.js";

const type_labels = {
    ban: "Permanent Ban",
    temp_ban: "Temp Ban",
    kick: "Kick",
    mute: "Mute",
    rolepersist: "Rolepersist",
};

type incident_info = {
    time: string;
    user: string;
    user_name: string;
    type: string;
    type_times: Map<keyof typeof type_labels, string>;
};

export default class DaysSinceLastIncident extends BotComponent {
    message: Discord.Message | null = null;
    last_time = "";
    timer!: NodeJS.Timeout;

    private days_since_last_incident!: Discord.TextChannel;

    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
        monke_button_presses: monke_button_press_entry;
    }>();

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.wheatley.event_hub.on("issue_moderation", this.handle_incident.bind(this));
    }

    override async setup() {
        this.days_since_last_incident = await this.utilities.get_channel(
            this.wheatley.channels.days_since_last_incident,
        );
    }

    async get_recent_moderations(): Promise<moderation_entry[]> {
        const cutoff = Date.now() - 30 * DAY;
        return await this.database.moderations
            .find({ type: { $ne: "note" }, issued_at: { $gte: cutoff } })
            .sort({ issued_at: -1 })
            .toArray();
    }

    async get_recent_monke_presses(): Promise<monke_button_press_entry[]> {
        const cutoff = Date.now() - 40 * DAY;
        return await this.database.monke_button_presses
            .find({ timestamp: { $gte: cutoff } })
            .sort({ timestamp: -1 })
            .toArray();
    }

    make_embed(incident: incident_info, moderations: moderation_entry[]) {
        const [count, unit] = incident.time.split(" ");
        const embed = new Discord.EmbedBuilder()
            .setColor(0xefd30a)
            .setDescription(
                build_description(
                    `# \`${count}\` \`${unit}\` since last incident`,
                    `**Last Punishment Type:** ${capitalize(incident.type)}`,
                ),
            );

        const type_breakdown_lines: string[] = [];
        for (const [type, label] of Object.entries(type_labels) as [keyof typeof type_labels, string][]) {
            const time = incident.type_times.get(type);
            if (time) {
                const [count, unit] = time.split(" ");
                type_breakdown_lines.push(`**${label}: \`${count}\` \`${unit}\`**`);
            } else {
                type_breakdown_lines.push(`**${label}: Never**`);
            }
        }

        embed.addFields({
            name: "Incident Drilldown",
            value: type_breakdown_lines.join("\n"),
            inline: false,
        });

        if (moderations.length > 1) {
            embed.addFields({
                name: "Survival Streaks (Last 30 Days)",
                value: `\`\`\`\n${this.calculate_time_frequency_histogram(moderations, "issued_at")}\n\`\`\``,
                inline: false,
            });

            const incident_chart = this.generate_time_interval_chart(
                moderations,
                "issued_at",
                "← Older          Incidents          Newer →",
                "No incidents to display",
            );
            embed.addFields({
                name: "Latest Scores",
                value: `\`\`\`\n${incident_chart}\n\`\`\``,
                inline: false,
            });
        }

        return embed;
    }

    async last_incident_info(): Promise<incident_info> {
        const moderations = await this.database.moderations
            .find({ type: { $ne: "note" } })
            .sort({ issued_at: -1 })
            .limit(1)
            .toArray();
        assert(moderations.length == 1);
        const last_incident = moderations[0];
        const delta = Date.now() - last_incident.issued_at;
        const time = this.format_time_delta(delta);

        const type_times = new Map<keyof typeof type_labels, string>();
        for (const key of Object.keys(type_labels) as (keyof typeof type_labels)[]) {
            const query = (() => {
                if (key === "ban") {
                    return { type: "ban" as const, duration: null };
                } else if (key === "temp_ban") {
                    return { type: "ban" as const, duration: { $ne: null } };
                } else {
                    return { type: key as moderation_type };
                }
            })();
            const type_moderations = await this.database.moderations
                .find(query)
                .sort({ issued_at: -1 })
                .limit(1)
                .toArray();
            if (type_moderations.length > 0) {
                const type_delta = Date.now() - type_moderations[0].issued_at;
                type_times.set(key, this.format_time_delta(type_delta));
            }
        }

        return {
            time,
            user: last_incident.user,
            user_name: last_incident.user_name,
            type: last_incident.type,
            type_times,
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

    render_ascii_bar_chart(
        data: number[],
        title: string,
        bottom_label: string,
        format_y_label: (value: number) => string,
    ): string {
        const chart_height = 8;
        const max_value = Math.max(...data, 1);
        const grid: string[][] = Array(chart_height)
            .fill(null)
            .map(() => Array(data.length).fill(" "));
        for (let col = 0; col < data.length; col++) {
            const bar_height = Math.round(((chart_height - 1) * data[col]) / max_value);
            for (let row = 0; row < bar_height; row++) {
                grid[chart_height - 1 - row][col] = "│";
            }
        }
        const y_labels = [];
        for (let i = 0; i < chart_height; i++) {
            const value = Math.round((max_value * (chart_height - 1 - i)) / (chart_height - 1));
            y_labels.push(format_y_label(value).padStart(4));
        }
        const lines = [];
        lines.push(title);
        for (let y = 0; y < chart_height; y++) {
            lines.push(`${y_labels[y]} ┤${grid[y].join("")}`);
        }
        lines.push(`     ┴${"─".repeat(data.length)}`);
        lines.push(
            `      ${" ".repeat(Math.max(0, Math.floor((data.length - bottom_label.length) / 2)))}${bottom_label}`,
        );
        return lines.join("\n");
    }

    generate_time_interval_chart<T extends { timestamp?: number; issued_at?: number }>(
        items: T[],
        timestamp_key: "timestamp" | "issued_at",
        label_text: string,
        no_data_message: string,
    ): string {
        const max_bars = 50;
        if (items.length === 0) {
            return no_data_message;
        }
        const time_between: number[] = [];
        for (let i = 0; i < items.length - 1; i++) {
            time_between.push(((items[i][timestamp_key] as number) - (items[i + 1][timestamp_key] as number)) / MINUTE);
        }
        const display_data = time_between.slice(0, max_bars).reverse();
        return this.render_ascii_bar_chart(display_data, "Time", label_text, value =>
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
        const max_bars = 40;
        if (daily_data.length === 0) {
            return "No press data to display";
        }
        const display_data = daily_data.slice(-max_bars).map(d => d.count);
        return this.render_ascii_bar_chart(display_data, "Presses", "← Older      Days      Newer →", value =>
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

    async make_monke_embed() {
        const recent_presses = await this.get_recent_monke_presses();
        const total_presses = await this.database.monke_button_presses.countDocuments();
        const unique_users = (
            await this.database.monke_button_presses.aggregate([{ $group: { _id: "$user" } }]).toArray()
        ).length;
        const daily_data = this.get_unique_presses_per_day(recent_presses);
        const average_presses = this.calculate_average_presses_per_day(daily_data);

        const embed = new Discord.EmbedBuilder().setColor(colors.wheatley);

        const last_press = await this.database.monke_button_presses.findOne({}, { sort: { timestamp: -1 } });
        if (last_press) {
            const delta = Date.now() - last_press.timestamp;
            const [count, unit] = this.format_time_delta(delta).split(" ");
            embed.setDescription(build_description(`# \`${count}\` \`${unit}\` since last monke press`));
        } else {
            embed.setDescription("# No monke button presses recorded");
        }

        embed.addFields({
            name: "Monke Button Statistics",
            value:
                `**Total Presses (All Time):** ${total_presses.toLocaleString("en-US")}\n` +
                `**Unique Users (All Time):** ${unique_users.toLocaleString("en-US")}\n` +
                `**Average Unique Presses/Day (Last 40 Days):** ${average_presses.toFixed(2)}\n` +
                `${this.analyze_historical_trend(daily_data)}`,
            inline: false,
        });

        if (daily_data.length > 0) {
            const chart = this.generate_presses_per_day_chart(daily_data);
            embed.addFields({
                name: "Unique Presses Per Day (Last 40 Days)",
                value: `\`\`\`\n${chart}\n\`\`\``,
                inline: false,
            });
        }

        return embed;
    }

    async update_or_send_if_needed() {
        const info = await this.last_incident_info();
        if (info.time !== this.last_time) {
            this.last_time = info.time;
            const moderations = await this.get_recent_moderations();
            await unwrap(this.message).edit({
                embeds: [this.make_embed(info, moderations), await this.make_monke_embed()],
            });
        }
    }

    override async on_ready() {
        const messages = (await this.days_since_last_incident.messages.fetch()).filter(
            message => message.author.id == this.wheatley.user.id,
        );
        assert(messages.size <= 1);
        if (messages.size == 1) {
            this.message = unwrap(messages.first());
            await this.update_or_send_if_needed();
        } else {
            const info = await this.last_incident_info();
            const moderations = await this.get_recent_moderations();
            this.last_time = info.time;
            await this.days_since_last_incident.send({
                embeds: [this.make_embed(info, moderations), await this.make_monke_embed()],
            });
        }
        this.timer = set_interval(() => {
            this.update_or_send_if_needed().catch(this.wheatley.critical_error.bind(this.wheatley));
        }, MINUTE);
    }

    handle_incident(moderation: moderation_entry) {
        if (moderation.type === "note") {
            return;
        }
        (async () => {
            await this.update_or_send_if_needed();
        })().catch(this.wheatley.critical_error.bind(this.wheatley));
    }
}
