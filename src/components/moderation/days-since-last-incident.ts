import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { critical_error } from "../../utils/debugging-and-logging.js";
import { unwrap } from "../../utils/misc.js";
import { time_to_human } from "../../utils/strings.js";
import { MINUTE } from "../../common.js";
import { moderation_entry } from "../../infra/schemata/moderation-common.js";

export default class DaysSinceLastIncident extends BotComponent {
    last_incident = 0;
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

    time_diff() {
        const delta = Date.now() - this.last_incident;
        if (delta < MINUTE) {
            return "0 minutes";
        } else {
            return time_to_human(delta, 1);
        }
    }

    async update_or_send_if_needed() {
        const time = this.time_diff();
        if (time !== this.last_time) {
            this.last_time = time;
            await unwrap(this.message).edit({
                embeds: [this.make_embed(time)],
            });
        }
    }

    override async on_ready() {
        const moderations = await this.wheatley.database.moderations.find().sort({ issued_at: -1 }).limit(1).toArray();
        if (moderations.length > 0) {
            assert(moderations.length == 1);
            this.last_incident = Math.max(this.last_incident, moderations[0].issued_at);
        }
        const messages = (await this.wheatley.channels.days_since_last_incident.messages.fetch()).filter(
            message => message.author.id == this.wheatley.id,
        );
        assert(messages.size <= 1);
        if (messages.size == 1) {
            this.message = unwrap(messages.first());
            await this.update_or_send_if_needed();
        } else {
            this.last_time = this.time_diff();
            await this.wheatley.channels.days_since_last_incident.send({
                embeds: [this.make_embed(this.last_time)],
            });
        }
        this.timer = setInterval(() => {
            this.update_or_send_if_needed().catch(critical_error);
        }, MINUTE);
    }

    handle_incident(moderation: moderation_entry) {
        (async () => {
            this.last_incident = Math.max(this.last_incident, moderation.issued_at);
            await this.update_or_send_if_needed();
        })().catch(critical_error);
    }
}
