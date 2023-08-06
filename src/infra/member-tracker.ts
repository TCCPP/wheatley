import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils.js";
import { MINUTE } from "../common.js";
import { Wheatley } from "../wheatley.js";

type member_entry = {
    tag: string;
    id: string;
    joined_at: number; // timestamp
    entry_added_at: number; // timestamp used for entry cleanup
    created_at: number; // timestamp
    purged: boolean; // already banned by !raidpurge?
    message_block: boolean; // set by anti-scambot when about to ban, addresses race condition on discord's end
};

type submodule = {
    on_join?: (_member: Discord.GuildMember, _now: number) => void;
    on_ban?: (_ban: Discord.GuildBan, _now: number) => void;
};

// how long we retain join info - 30 minutes for now
const LOG_DURATION = 30 * MINUTE;

export class MemberTracker {
    entries: member_entry[] = [];
    // map from user id -> member entry
    id_map: Map<Discord.Snowflake, member_entry> = new Map();
    // user id snowflake -> messages with pings
    ping_map: Map<string, Discord.Message[]> = new Map();
    // user id snowflake -> messages with links
    link_map: Map<string, Discord.Message[]> = new Map();
    // set of user id snowflakes to prevent race condition
    // snowflake -> timestamp of addition to this set
    currently_banning: Map<string, number> = new Map();
    // modules that rely on on_join and on_ban
    submodules: submodule[] = [];
    interval: NodeJS.Timer;
    constructor(readonly wheatley: Wheatley) {
        // every 10 minutes, trim extraneous entries
        this.interval = setInterval(this.trim.bind(this), 10 * MINUTE);
        wheatley.client.on("guildMemberAdd", this.on_join.bind(this));
        wheatley.client.on("guildBanAdd", this.on_ban.bind(this));
    }

    destroy() {
        clearInterval(this.interval);
    }

    // Bookkeeping
    trim() {
        const now = Date.now();
        // -- join logs --
        const first_in_timeframe = this.entries.findIndex(entry => now - entry.entry_added_at <= LOG_DURATION);
        if (first_in_timeframe == -1) return;
        // debugging checks
        // just check sorted order of everything
        for (let i = first_in_timeframe; i < this.entries.length; i++) {
            assert(now - this.entries[i].entry_added_at <= LOG_DURATION);
        }
        // remove entries from id_map
        for (let i = 0; i < first_in_timeframe; i++) {
            assert(now - this.entries[i].entry_added_at > LOG_DURATION);
            this.id_map.delete(this.entries[i].id);
        }
        // remove entries before cutoff
        this.entries = this.entries.slice(first_in_timeframe);
        // -- ping/link maps --
        for (const map of [this.ping_map, this.link_map]) {
            for (let [k, v] of map) {
                /* eslint-disable-line prefer-const */
                v = v.filter(m => now - m.createdTimestamp <= LOG_DURATION);
                if (v.length == 0) {
                    this.ping_map.delete(k);
                }
            }
        }
        for (const [id, timestamp] of this.currently_banning) {
            // Don't keep around for more than 10 minutes, just need to address race condition
            if (now - timestamp <= 5 * MINUTE) {
                this.currently_banning.delete(id);
            }
        }
    }
    on_join(member: Discord.GuildMember) {
        M.debug("member join:", member.id, member.user.tag);
        assert(member.joinedAt != null);
        // TODO: which one to use.....
        //let now = Date.now();
        const now = member.joinedAt.getTime();
        this.entries.push({
            tag: member.user.tag,
            id: member.id,
            joined_at: now,
            entry_added_at: Date.now(),
            created_at: member.user.createdTimestamp,
            purged: false,
            message_block: false,
        });
        if (this.id_map.has(member.id)) {
            // This can happen under normal operation: User joins then leaves then rejoins
            M.warn("this.id_map.has(member.id)");
        }
        this.id_map.set(member.id, this.entries[this.entries.length - 1]);
        if (!this.wheatley.ready) {
            // don't fire events until wheatley setup is complete
            // could queue calls until wheatley is ready but it is not critical we catch events in the split second
            // wheatley isn't ready
            return;
        }
        for (const { on_join } of this.submodules) {
            if (on_join) {
                try {
                    on_join(member, now);
                } catch (e) {
                    critical_error(e);
                }
            }
        }
    }
    on_ban(ban: Discord.GuildBan) {
        const now = Date.now();
        const user = ban.user;
        M.debug("User banned: ", [user.tag, user.id]);
        if (!this.wheatley.ready) {
            // don't fire events until wheatley setup is complete
            // could queue calls until wheatley is ready but it is not critical we catch events in the split second
            // wheatley isn't ready
            return;
        }
        for (const { on_ban } of this.submodules) {
            if (on_ban) {
                try {
                    on_ban(ban, now);
                } catch (e) {
                    critical_error(e);
                }
            }
        }
    }
    // API
    add_submodule(submodule: submodule) {
        this.submodules.push(submodule);
    }
    add_pseudo_entry(user: Discord.User) {
        if (this.id_map.has(user.id)) {
            // This should never happen under normal operation based off of where this function is
            // called from
            M.error("this.id_map.has(user.id) -- add_pseudo_entry");
            return;
        }
        this.entries.push({
            tag: user.tag,
            id: user.id,
            joined_at: 0,
            entry_added_at: Date.now(),
            created_at: user.createdTimestamp,
            purged: false,
            message_block: false,
        });
        this.id_map.set(user.id, this.entries[this.entries.length - 1]);
    }
}
