import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";
import { MINUTE } from "./common";

type member_entry = {
    tag: string,
    id: string,
    joined_at: number, // timestamp
    entry_added_at: number, // timestamp used for entry cleanup
    created_at: number, // timestamp
    purged: boolean, // already banned by !raidpurge?
    message_block: boolean // set by anti-scambot when about to ban, addresses race condition on discord's end
};

type submodule = {
    on_join?: (member: Discord.GuildMember, now: number) => void,
    on_ban?: (ban: Discord.GuildBan, now: number) => void
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
    constructor(client: Discord.Client) {
        // every 10 minutes, trim extraneous entries
        setInterval(this.trim.bind(this), 10 * MINUTE);
        client.on("guildMemberAdd", this.on_join.bind(this));
        client.on("guildBanAdd", this.on_ban.bind(this));
    }
    // Bookkeeping
    trim() {
        let now = Date.now();
        // -- join logs --
        let first_in_timeframe = this.entries.findIndex(entry => now - entry.entry_added_at <= LOG_DURATION);
        if(first_in_timeframe == -1) return;
        // debugging checks
        // just check sorted order of everything
        for(let i = first_in_timeframe; i < this.entries.length; i++) {
            assert(now - this.entries[i].entry_added_at <= LOG_DURATION);
        }
        // remove entries from id_map
        for(let i = 0; i < first_in_timeframe; i++) {
            assert(now - this.entries[i].entry_added_at > LOG_DURATION);
            this.id_map.delete(this.entries[i].id);
        }
        // remove entries before cutoff
        this.entries = this.entries.slice(first_in_timeframe);
        // -- ping/link maps --
        for(let map of [this.ping_map, this.link_map]) {
            for(let [k, v] of map) {
                v = v.filter(m => now - m.createdTimestamp <= LOG_DURATION);
                if(v.length == 0) {
                    this.ping_map.delete(k);
                }
            }
        }
        for(let [id, timestamp] of this.currently_banning) {
            if(now - timestamp <= 5 * MINUTE) { // Don't keep around for more than 10 minutes, just need to address race condition
                this.currently_banning.delete(id);
            }
        }
    }
    on_join(member: Discord.GuildMember) {
        M.debug("member join:", member.id, member.user.tag);
        assert(member.joinedAt != null);
        // TODO: which one to use.....
        //let now = Date.now();
        let now = member.joinedAt.getTime();
        this.entries.push({
            tag: member.user.tag,
            id: member.id,
            joined_at: now,
            entry_added_at: Date.now(),
            created_at: member.user.createdTimestamp,
            purged: false,
            message_block: false
        });
        if(this.id_map.has(member.id)) {
            // This can happen under normal operation: User joins then leaves then rejoins
            M.warn("this.id_map.has(member.id)");
        }
        this.id_map.set(member.id, this.entries[this.entries.length - 1]);
        for(let { on_join } of this.submodules) {
            if(on_join) on_join(member, now);
        }
    }
    on_ban(ban: Discord.GuildBan) {
        let now = Date.now();
        let user = ban.user;
        M.debug("User banned: ", [user.tag, user.id]);
        for(let { on_ban } of this.submodules) {
            if(on_ban) on_ban(ban, now);
        }
    }
    // API
    add_submodule(submodule: submodule) {
        this.submodules.push(submodule);
    }
    add_pseudo_entry(user: Discord.User) {
        if(this.id_map.has(user.id)) {
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
            message_block: false
        });
        this.id_map.set(user.id, this.entries[this.entries.length - 1]);
    }
}
