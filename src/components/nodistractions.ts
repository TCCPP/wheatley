import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { no_off_topic } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

/*
 * !nodistractions
 * - Apply role when commanded
 * - Make sure user isn't already in !nodistractions
 * - Make sure user doesn't already have @No Off Topic, otherwise susceptible to exploit
 * - Make entry in database
 * - Reschedule timer if necessary
 * - DM with instructions for how to end
 * On restart:
 * - Re-setup timers
 * On !removenodistractions:
 * - Remove from !nodistractions
 * - Make sure user is in !nodistractions otherwise susceptible to exploit
 * On remove from !nodistractions:
 * - Remove role and database entry
 */

function send_error(original_message: Discord.Message, message: string) {
    original_message.reply(`Error: ${message}`);
}

function parse_unit(u: string) {
    let factor = 1000; // in ms
    switch(u) {
        case "C":
        case "c":
            factor *= 100; // 100 years, fallthrough
        case "Y":
        case "y":
            factor *= 365; // 365 days, fallthrough
        case "d":
            factor *= 24; // 24 hours, fallthrough
        case "h":
            factor *= 60; // 60 minutes, fallthrough
        case "m":
            factor *= 60; // 60 seconds
            break;
        // Weeks and months can't be folded into the above as nicely
        case "w":
            factor *= 7 * parse_unit("d");
            break;
        case "M":
            factor *= 30 * parse_unit("d");
            break;
        default:
            return -1;
    }
    return factor;
}

const nodistractions_re = /^!nodistractions\s*(\d*)\s*(\w*)/i;
const INT_MAX = 0x7FFFFFFF;

type no_distraction_entry = {
    id: Discord.Snowflake,
    start: number,
    duration: number
};

type database_entry = {
    start: number,
    duration: number
};

type database_schema = {
    // map of user id -> database_entry
    [key: string]: database_entry
};

export class Nodistractions extends BotComponent {
    // Sorted by !nodistractions end time
    undistract_queue: no_distraction_entry[] = [];
    timer: NodeJS.Timer | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);

        if(!this.wheatley.database.has("nodistractions")) {
            this.wheatley.database.set<database_schema>("nodistractions", {
                /*
                 * map of user id -> database_entry
                 */
            });
        }
        // load entries
        for(const [ id, entry ] of Object.entries(this.wheatley.database.get<database_schema>("nodistractions"))) {
            this.undistract_queue.push({
                id,
                start: entry.start,
                duration: entry.duration
            });
        }
    }

    override async on_ready() {
        if(this.undistract_queue.length > 0) {
            this.undistract_queue.sort((a, b) => (a.start + a.duration) - (b.start + b.duration));
            this.set_timer();
        }
    }

    async handle_timer() {
        this.timer = null;
        try {
            // sanity checks
            assert(this.undistract_queue.length > 0);
            if(this.undistract_queue[0].start + this.undistract_queue[0].duration > Date.now()) {
                // can happen under excessively long sleeps
                assert(this.undistract_queue[0].duration > INT_MAX);
                this.set_timer(); // set next timer
                return;
            }
            // pop entry and remove role
            const entry = this.undistract_queue.shift()!;
            const member = await this.wheatley.TCCPP.members.fetch(entry.id);
            M.log("removing !nodistractions", member.id, member.user.tag);
            if(member.roles.cache.some(r => r.id == no_off_topic)) { // might have been removed externally
                await member.roles.remove(no_off_topic);
            }
            member.send("You have been removed from !nodistractions");
            // remove database entry
            delete this.wheatley.database.get<database_schema>("nodistractions")[entry.id];
            this.wheatley.database.update();
            // reschedule, intentionally not rescheduling
            if(this.undistract_queue.length > 0) {
                this.set_timer();
            }
        } catch(e) {
            critical_error(e);
        }
    }

    set_timer() {
        assert(this.timer == null);
        assert(this.undistract_queue.length > 0);
        const next = this.undistract_queue[0];
        // next.start + next.duration - Date.now() but make sure overflow is prevented
        const sleep_time = (next.start - Date.now()) + next.duration;
        this.timer = setTimeout(this.handle_timer.bind(this), Math.min(sleep_time, INT_MAX));
    }

    async apply_no_distractions(target: Discord.GuildMember, message: Discord.Message, start: number,
        duration: number) {
        M.log("Applying !nodistractions", target.user.id, target.user.tag);
        // error handling
        if(target.roles.cache.some(r => r.id == no_off_topic)) {
            if(target.id in this.wheatley.database.get<database_schema>("nodistractions")) {
                send_error(message, "You're already in !nodistractions");
            } else {
                send_error(message, "Nice try.");
                this.wheatley.zelis.send(`Exploit attempt ${message.url}`);
            }
            return;
        }
        if(duration >= Number.MAX_SAFE_INTEGER) { // prevent timer overflow
            send_error(message, "Invalid timeframe");
            return;
        }
        // apply role, dm, react
        try {
            await target.roles.add(no_off_topic);
        } catch(e) {
            M.error(e);
            return;
        }
        target.send("!nodistractions applied, use !removenodistractions to exit")
            .catch(e => e.status != 403 ? M.error(e) : 0);
        message.react("👍").catch(M.error);
        // make entry
        const entry: no_distraction_entry = {
            id: target.id,
            start,
            duration
        };
        // Insert into appropriate place in the queue
        let i = 0;
        for( ; i < this.undistract_queue.length; i++) {
            if(this.undistract_queue[i].start + this.undistract_queue[i].duration >= start + duration) {
                break;
            }
        }
        this.undistract_queue.splice(i, 0, entry);
        this.wheatley.database.get<database_schema>("nodistractions")[target.id] = {
            start,
            duration
        };
        this.wheatley.database.update();
        // apply
        if(i == 0 && this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if(this.timer == null) {
            this.set_timer();
        }
    }

    async early_remove_nodistractions(target: Discord.GuildMember, message: Discord.Message) {
        // checks
        assert(target.id in this.wheatley.database.get<database_schema>("nodistractions"));
        // timer
        const reschedule = this.timer != null;
        if(this.timer != null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        // remove role
        await target.roles.remove(no_off_topic);
        // check again
        assert(target.id in this.wheatley.database.get<database_schema>("nodistractions"));
        if(!this.undistract_queue.some(e => e.id == target.id)) {
            critical_error("Not good");
        }
        // remove entry
        delete this.wheatley.database.get<database_schema>("nodistractions")[target.id];
        this.undistract_queue = this.undistract_queue.filter(e => e.id != target.id);
        this.wheatley.database.update();
        message.react("👍").catch(M.error);
        target.send("You have been removed from !nodistractions").catch(e => e.status != 403 ? M.error(e) : 0);
        // reschedule if necessary
        if(reschedule && this.undistract_queue.length > 0) {
            this.set_timer();
        }
    }


    override async on_message_create(message: Discord.Message) {
        if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots

        if(message.content.trim().toLowerCase() == "!nodistractions") {
            const reply = await message.channel.send("`!nodistractions <time>` where time is an integer followed by one"
                                                   + " of the following units: m, h, d, w, M, y"
                                                   + "\n`!removenodistractions` to remove nodistractions");
            this.wheatley.deletable.make_message_deletable(message, reply);
            return;
        }

        if(message.content.trim().toLowerCase() == "!removenodistractions") {
            M.log("Received !removenodistractions", message.author.id, message.author.tag);
            let member = message.member;
            if(member == null) {
                try {
                    member = await this.wheatley.TCCPP.members.fetch(message.author.id);
                } catch(e) {
                    critical_error(e);
                    message.reply("internal error with fetching user");
                    this.wheatley.zelis.send("internal error with fetching user");
                    return;
                }
            }
            if(!member.roles.cache.some(r => r.id == no_off_topic)) {
                send_error(message, "You are not currently in !nodistractions");
                return;
            }
            if(!(member.id in this.wheatley.database.get<database_schema>("nodistractions"))) {
                send_error(message, "Nice try.");
                this.wheatley.zelis.send(`Exploit attempt ${message.url}`);
                return;
            }
            this.early_remove_nodistractions(member, message);
            return;
        }

        // "!nodistractions 123d asdfdsaf".match(/^!nodistractions\s*(\d*)\s*(\w*)/)
        // [ "!nodistractions 123d", "123", "d" ]
        const match = message.content.match(nodistractions_re);
        if(match != null) {
            M.debug("Received !nodistractions", message.author.id, message.author.tag);
            assert(match.length == 3);
            const n = parseInt(match[1]);
            const u = match[2];
            if(isNaN(n)) {
                send_error(message, "Empty time field");
                return;
            }
            if(u == "") {
                send_error(message, "Missing units");
                return;
            }
            const factor = parse_unit(u);
            if(factor == -1) {
                send_error(message, "Unknown units");
                return;
            }
            M.debug("Timeframe: ", n, u, factor);
            let member = message.member;
            if(member == null) {
                try {
                    member = await this.wheatley.TCCPP.members.fetch(message.author.id);
                } catch(e) {
                    critical_error(e);
                    message.reply("Internal error with fetching user");
                    this.wheatley.zelis.send("Internal error with fetching user");
                    return;
                }
            }
            this.apply_no_distractions(member, message, message.createdTimestamp, n * factor);
        }
    }
}
