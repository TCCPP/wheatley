import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { unwrap } from "../utils/misc.js";
import { build_description, capitalize, time_to_human } from "../utils/strings.js";
import { MINUTE } from "../common.js";
import { moderation_entry } from "../infra/schemata/moderation.js";
import { set_interval } from "../utils/node.js";

type incident_info = { time: string; user: string; user_name: string; type: string };

export default class DaysSinceLastIncident extends BotComponent {
    message: Discord.Message | null = null;
    last_time = "";
    timer: NodeJS.Timeout;

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.wheatley.event_hub.on("issue_moderation", this.handle_incident.bind(this));
    }

    make_embed(incident: incident_info) {
        const [count, unit] = incident.time.split(" ");
        return new Discord.EmbedBuilder()
            .setColor(0xefd30a)
            .setDescription(
                build_description(
                    `# \`${count}\` \`${unit}\` since last incident`,
                    `**Culprit:** <@${incident.user}> ("${incident.user_name}")`,
                    `**Punishment:** ${capitalize(incident.type)}`,
                ),
            );
    }

    async last_incident_info(): Promise<incident_info> {
        const moderations = await this.wheatley.database.moderations
            .find({ type: { $ne: "note" } })
            .sort({ issued_at: -1 })
            .limit(1)
            .toArray();
        assert(moderations.length == 1);
        const last_incident = moderations[0];
        const delta = Date.now() - last_incident.issued_at;
        const time = delta < MINUTE ? "0 minutes" : time_to_human(delta, 1);
        return { time, user: last_incident.user, user_name: last_incident.user_name, type: last_incident.type };
    }

    async update_or_send_if_needed() {
        const info = await this.last_incident_info();
        if (info.time !== this.last_time) {
            this.last_time = info.time;
            await unwrap(this.message).edit({
                embeds: [this.make_embed(info)],
            });
        }
    }

    override async on_ready() {
        const messages = (await this.wheatley.channels.days_since_last_incident.messages.fetch()).filter(
            message => message.author.id == this.wheatley.id,
        );
        assert(messages.size <= 1);
        if (messages.size == 1) {
            this.message = unwrap(messages.first());
            await this.update_or_send_if_needed();
        } else {
            const info = await this.last_incident_info();
            this.last_time = info.time;
            await this.wheatley.channels.days_since_last_incident.send({
                embeds: [this.make_embed(info)],
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
