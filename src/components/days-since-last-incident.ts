import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { unwrap } from "../utils/misc.js";
import { time_to_human } from "../utils/strings.js";
import { MINUTE } from "../common.js";
import { moderation_entry } from "../infra/schemata/moderation.js";
import { set_interval } from "../utils/node.js";

export default class DaysSinceLastIncident extends BotComponent {
    message: Discord.Message | null = null;
    last_time = "";
    timer: NodeJS.Timeout;

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.wheatley.event_hub.on("issue_moderation", this.handle_incident.bind(this));
    }

    make_embed(time: string) {
        const [count, unit] = time.split(" ");
        return new Discord.EmbedBuilder()
            .setColor(0xefd30a)
            .setDescription(`# \`${count}\` \`${unit}\` since last incident`);
    }

    async time_since_last_incident() {
        const moderations = await this.wheatley.database.moderations
            .find({ type: { $ne: "note" } })
            .sort({ issued_at: -1 })
            .limit(1)
            .toArray();
        assert(moderations.length == 1);
        const last_incident = moderations[0].issued_at;
        const delta = Date.now() - last_incident;
        if (delta < MINUTE) {
            return "0 minutes";
        } else {
            return time_to_human(delta, 1);
        }
    }

    async update_or_send_if_needed() {
        const time = await this.time_since_last_incident();
        if (time !== this.last_time) {
            this.last_time = time;
            await unwrap(this.message).edit({
                embeds: [this.make_embed(time)],
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
            this.last_time = await this.time_since_last_incident();
            await this.wheatley.channels.days_since_last_incident.send({
                embeds: [this.make_embed(this.last_time)],
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
