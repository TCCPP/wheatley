import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";
import { build_description, capitalize, time_to_human } from "../../../utils/strings.js";
import { DAY, MINUTE } from "../../../common.js";
import { moderation_entry, moderation_type } from "../../../components/moderation/schemata.js";
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
            const survival_streaks = this.calculate_survival_streaks(moderations);
            embed.addFields({
                name: "Survival Streaks (Last 30 Days)",
                value: `\`\`\`\n${survival_streaks}\n\`\`\``,
                inline: false,
            });

            const ascii_chart = this.generate_record_attempts_ascii_chart(moderations);
            embed.addFields({
                name: "Latest Scores",
                value: `\`\`\`\n${ascii_chart}\n\`\`\``,
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
        const time = delta < MINUTE ? "0 minutes" : time_to_human(delta, 1);

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
                const type_time = type_delta < MINUTE ? "0 minutes" : time_to_human(type_delta, 1);
                type_times.set(key, type_time);
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

    calculate_survival_streaks(moderations: moderation_entry[]): string {
        const buckets = {
            "<1 min": 0,
            "1-5 min": 0,
            "5-15 min": 0,
            "15-60 min": 0,
            "1-6 hrs": 0,
            "6-24 hrs": 0,
            "1+ day": 0,
        };

        for (let i = 0; i < moderations.length - 1; i++) {
            const time_between = moderations[i].issued_at - moderations[i + 1].issued_at;
            const minutes = time_between / MINUTE;

            if (minutes < 1) {
                buckets["<1 min"]++;
            } else if (minutes < 5) {
                buckets["1-5 min"]++;
            } else if (minutes < 15) {
                buckets["5-15 min"]++;
            } else if (minutes < 60) {
                buckets["15-60 min"]++;
            } else if (minutes < 360) {
                buckets["1-6 hrs"]++;
            } else if (minutes < 1440) {
                buckets["6-24 hrs"]++;
            } else {
                buckets["1+ day"]++;
            }
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

    generate_record_attempts_ascii_chart(moderations: moderation_entry[]): string {
        const chart_height = 8;
        const max_bars = 50;

        if (moderations.length === 0) {
            return "No incidents to display";
        }

        const time_between: number[] = [];
        for (let i = 0; i < moderations.length - 1; i++) {
            time_between.push((moderations[i].issued_at - moderations[i + 1].issued_at) / MINUTE);
        }

        const display_data = time_between.slice(0, max_bars).reverse();
        const max_time = Math.max(...display_data, 1);

        const grid: string[][] = Array(chart_height)
            .fill(null)
            .map(() => Array(display_data.length).fill(" "));

        for (let col = 0; col < display_data.length; col++) {
            const bar_height = Math.round(((chart_height - 1) * display_data[col]) / max_time);
            for (let row = 0; row < bar_height; row++) {
                grid[chart_height - 1 - row][col] = "│";
            }
        }

        const y_labels = [];
        for (let i = 0; i < chart_height; i++) {
            const value = Math.round((max_time * (chart_height - 1 - i)) / (chart_height - 1));
            const label = value >= 60 ? `${Math.floor(value / 60)}h` : `${value}m`;
            y_labels.push(label.padStart(4));
        }

        const lines = [];
        lines.push("Time");
        for (let y = 0; y < chart_height; y++) {
            lines.push(`${y_labels[y]} ┤${grid[y].join("")}`);
        }

        lines.push(`     ┴${"─".repeat(display_data.length)}`);
        const label_text = "← Older          Incidents          Newer →";
        lines.push(`      ${" ".repeat(Math.floor((display_data.length - label_text.length) / 2))}${label_text}`);

        return lines.join("\n");
    }

    async update_or_send_if_needed() {
        const info = await this.last_incident_info();
        if (info.time !== this.last_time) {
            this.last_time = info.time;
            const moderations = await this.get_recent_moderations();
            await unwrap(this.message).edit({
                embeds: [this.make_embed(info, moderations)],
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
                embeds: [this.make_embed(info, moderations)],
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
