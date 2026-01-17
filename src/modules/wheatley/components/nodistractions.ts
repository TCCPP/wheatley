import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { set_timeout, clear_timeout } from "../../../utils/node.js";
import { unwrap } from "../../../utils/misc.js";

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

// TODO: Rephrase in terms of a moderation component

function parse_unit(u: string) {
    let factor = 1000; // in ms
    switch (u) {
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

const nodistractions_arg_re = /^(\d*)\s*(\w*)/i;
const INT_MAX = 0x7fffffff;

type no_distraction_entry = {
    user: string;
    start: number;
    duration: number;
};

export default class Nodistractions extends BotComponent {
    // Sorted by !nodistractions end time
    undistract_queue: no_distraction_entry[] = [];
    timer: NodeJS.Timeout | null = null;

    private database = this.wheatley.database.create_proxy<{
        nodistractions: no_distraction_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        await this.database.nodistractions.createIndex({ user: 1 }, { unique: true });

        commands.add(
            new TextBasedCommandBuilder("nodistractions", EarlyReplyMode.ephemeral)
                .set_category("Utility")
                .set_description("Turns on nodistractions")
                .add_string_option({
                    title: "time",
                    description: "How long to go in nodistractions",
                    required: true,
                })
                .set_handler(this.nodistractions.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("removenodistractions", EarlyReplyMode.ephemeral)
                .set_category("Utility")
                .set_description("Removes nodistractions")
                .set_handler(this.removenodistractions.bind(this)),
        );
    }

    override async on_ready() {
        // load entries
        for await (const { user, start, duration } of this.database.nodistractions.find()) {
            this.undistract_queue.push({ user, start, duration });
        }

        if (this.undistract_queue.length > 0) {
            this.undistract_queue.sort((a, b) => a.start + a.duration - (b.start + b.duration));
            this.set_timer();
        }
    }

    async handle_timer() {
        this.timer = null;
        try {
            // sanity checks
            assert(this.undistract_queue.length > 0);
            if (this.undistract_queue[0].start + this.undistract_queue[0].duration > Date.now()) {
                // can happen under excessively long sleeps
                assert(this.undistract_queue[0].duration > INT_MAX);
                this.set_timer(); // set next timer
                return;
            }
            // pop entry and remove role
            const entry = this.undistract_queue.shift()!;
            try {
                const member = await this.wheatley.guild.members.fetch(entry.user);
                M.log("removing !nodistractions", member.id, member.user.tag);
                if (member.roles.cache.some(r => r.id == this.wheatley.roles.no_off_topic.id)) {
                    // might have been removed externally
                    await member.roles.remove(this.wheatley.roles.no_off_topic.id);
                }
            } catch (e) {
                if (e instanceof Discord.DiscordAPIError && e.code == 10007) {
                    // unknown member - just silently continue removing from the database as the user  of course now no
                    // longer has the role
                } else {
                    // rethrow, handle below
                    throw e;
                }
            }
            // remove database entry
            await this.database.nodistractions.deleteOne({ user: entry.user });
            // reschedule, intentionally not rescheduling
            if (this.undistract_queue.length > 0) {
                this.set_timer();
            }
        } catch (e) {
            this.wheatley.critical_error(e);
        }
    }

    set_timer() {
        assert(this.timer == null);
        assert(this.undistract_queue.length > 0);
        const next = this.undistract_queue[0];
        // next.start + next.duration - Date.now() but make sure overflow is prevented
        const sleep_time = next.start - Date.now() + next.duration;
        this.timer = set_timeout(
            () => {
                this.handle_timer().catch(this.wheatley.critical_error.bind(this.wheatley));
            },
            Math.min(sleep_time, INT_MAX),
        );
    }

    async apply_no_distractions(
        command: TextBasedCommand,
        target: Discord.GuildMember,
        start: number,
        duration: number,
    ) {
        M.log("Applying !nodistractions", target.user.id, target.user.tag);
        // error handling
        if (target.roles.cache.some(r => r.id == this.wheatley.roles.no_off_topic.id)) {
            if ((await this.database.nodistractions.findOne({ user: target.id })) !== null) {
                await command.reply("You're already in !nodistractions", true, true);
            } else {
                await command.reply("Nice try.", true, true);
                this.wheatley.alert("Exploit attempt" + (command.is_slash() ? "" : " " + command.get_or_forge_url()));
            }
            return;
        }
        if (duration >= Number.MAX_SAFE_INTEGER) {
            // prevent timer overflow
            await command.reply("Invalid timeframe", true, true);
            return;
        }
        // apply role, dm, react
        try {
            await target.roles.add(this.wheatley.roles.no_off_topic.id);
        } catch (e) {
            M.error(e);
            return;
        }
        command.react("✅").catch(M.error);
        // make entry
        const entry: no_distraction_entry = {
            user: target.id,
            start,
            duration,
        };
        // Insert into appropriate place in the queue
        let i = 0;
        for (; i < this.undistract_queue.length; i++) {
            if (this.undistract_queue[i].start + this.undistract_queue[i].duration >= start + duration) {
                break;
            }
        }
        this.undistract_queue.splice(i, 0, entry);
        await this.database.nodistractions.insertOne({
            user: target.id,
            start,
            duration,
        });
        // apply
        i = this.undistract_queue.findIndex(entry => entry.user == target.id); // index may have changed
        if (i == 0 && this.timer != null) {
            clear_timeout(this.timer);
            this.timer = null;
        }
        if (this.timer == null) {
            this.set_timer();
        }
    }

    async early_remove_nodistractions(command: TextBasedCommand, target: Discord.GuildMember) {
        // checks
        assert((await this.database.nodistractions.findOne({ user: target.id })) !== null);
        // timer
        const reschedule = this.timer != null;
        if (this.timer != null) {
            clear_timeout(this.timer);
            this.timer = null;
        }
        // remove role
        await target.roles.remove(this.wheatley.roles.no_off_topic.id);
        // check again
        assert((await this.database.nodistractions.findOne({ user: target.id })) !== null);
        if (!this.undistract_queue.some(e => e.user == target.id)) {
            this.wheatley.critical_error("Not good");
        }
        // remove entry
        this.undistract_queue = this.undistract_queue.filter(e => e.user != target.id);
        await this.database.nodistractions.deleteOne({ user: target.id });
        command.react("✅").catch(M.error);
        // reschedule if necessary
        if (reschedule && this.undistract_queue.length > 0) {
            this.set_timer();
        }
    }

    async nodistractions(command: TextBasedCommand, arg: string) {
        if (arg == "") {
            M.debug("Received !nodistractions", command.user.id, command.user.tag);
            await command.reply(
                "`!nodistractions <time>` where time is an integer followed by one of the following" +
                    " units: m, h, d, w, M, y\n`!removenodistractions` to remove nodistractions",
                true,
                true,
            );
        } else {
            M.debug("Received !nodistractions", arg, command.user.id, command.user.tag);
            // "123d".match(nodistractions_arg_re)
            // [ "123d", "123", "d" ]
            const match = arg.match(nodistractions_arg_re)!;
            assert(match.length == 3);
            const n = parseInt(match[1]);
            const u = match[2];
            if (isNaN(n)) {
                await command.reply("Empty time field", true, true);
                return;
            }
            if (u == "") {
                await command.reply("Missing units", true, true);
                return;
            }
            const factor = parse_unit(u);
            if (factor == -1) {
                await command.reply("Unknown units", true, true);
                return;
            }
            M.debug("Timeframe: ", n, u, factor);
            const member = await command.get_member(this.wheatley.guild);
            await this.apply_no_distractions(command, member, Date.now(), n * factor);
        }
    }

    async removenodistractions(command: TextBasedCommand) {
        const member = await command.get_member(this.wheatley.guild);
        if (!member.roles.cache.some(r => r.id == this.wheatley.roles.no_off_topic.id)) {
            await command.reply("You are not currently in !nodistractions", true, true);
            return;
        }
        if ((await this.database.nodistractions.findOne({ user: member.id })) === null) {
            await command.reply("Nice try.", true, true);
            this.wheatley.alert("Exploit attempt" + (command.is_slash() ? "" : " " + command.get_or_forge_url()));
            return;
        }
        await this.early_remove_nodistractions(command, member);
    }
}
