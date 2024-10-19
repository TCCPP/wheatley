import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE } from "../common.js";
import { Wheatley } from "../wheatley.js";
import { set_timeout } from "../utils/node.js";
import { unwrap } from "../utils/misc.js";
import PromClient from "prom-client";

const RATE_LIMIT = 5; // messages per minute

export type LoggableChannel = Discord.GuildTextBasedChannel | Discord.ThreadChannel;

export class LogLimiter {
    private readonly log_queue: [LoggableChannel, Discord.MessageCreateOptions][] = [];

    queued_counter = new PromClient.Counter({
        name: "tccpp_log_limiter_queued_count",
        help: "tccpp_log_limiter_queued_count",
    });

    dequeued_counter = new PromClient.Counter({
        name: "tccpp_log_limiter_dequeued_count",
        help: "tccpp_log_limiter_dequeued_count",
    });

    constructor(private readonly wheatley: Wheatley) {
        this.schedule_next();
    }

    public log(channel: LoggableChannel, message: Discord.MessageCreateOptions) {
        this.log_queue.push([channel, message]);
        this.queued_counter.inc();
    }

    private schedule_next() {
        set_timeout(
            () => {
                this.do_log().catch(this.wheatley.critical_error.bind(this.wheatley));
            },
            (1 * MINUTE) / RATE_LIMIT,
        );
    }

    private async do_log() {
        try {
            if (this.log_queue.length > 0) {
                const [channel, to_send] = unwrap(this.log_queue.shift());
                this.dequeued_counter.inc();
                await channel.send(to_send);
            }
        } finally {
            this.schedule_next();
        }
    }
}
