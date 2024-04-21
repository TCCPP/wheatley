import * as Discord from "discord.js";
import * as mongo from "mongodb";
import PromClient from "prom-client";

import { EventEmitter } from "events";

import { strict as assert } from "assert";

import { critical_error } from "../../utils/debugging-and-logging.js";
import { M } from "../../utils/debugging-and-logging.js";

import { unwrap } from "../../utils/misc.js";
import { build_description, capitalize } from "../../utils/strings.js";
import { time_to_human } from "../../utils/strings.js";
import { DistributedOmit } from "../../utils/typing.js";
import { SleepList } from "../../utils/containers.js";
import { Mutex } from "../../utils/containers.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { colors, HOUR } from "../../common.js";
import Modlogs from "./modlogs.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import {
    moderation_type,
    moderation_entry,
    basic_moderation_with_user,
    basic_moderation,
} from "../../infra/schemata/moderation-common.js";
import { set_interval } from "../../utils/node.js";

import { get_random_array_element } from "../../utils/arrays.js";

/*
 * !mute !unmute
 * !ban !unban
 * !kick
 * !rolepersist add/remove
 * !warn
 * !noofftopic
 * !timeout
 *
 * !reason
 * !duration
 * !expunge
 * !modlogs
 * !case
 *
 * !purge
 * !lockdown
 * !note
 *
 * Buttons for !case
 * Link users to modmail for appeals, also include appeal info in dm notifications
 *
 */

export const duration_regex = /(?:perm\b|(\d+)\s*([mhdwMys]))/;

export const moderation_on_team_member_message: string = "Can't apply this moderation on team members";
export const joke_responses = [
    "You won't get off that easy! ;)",
    "Try again next time lmao",
    "Didn't work. Maybe a skill issue?",
];

// returns duration in ms
function parse_unit(u: string) {
    let factor = 1;
    switch (u) {
        case "y":
            factor *= 365; // 365 days, fallthrough
        case "d":
            factor *= 24; // 24 hours, fallthrough
        case "h":
            factor *= 60; // 60 minutes, fallthrough
        case "m":
            factor *= 60; // 60 seconds, fallthrough
        case "s":
            factor *= 1000; // 1000 ms
            break;
        // Weeks and months can't be folded into the above as nicely
        case "w":
            factor *= 7 * parse_unit("d");
            break;
        case "M":
            factor *= 30 * parse_unit("d");
            break;
        default:
            assert(false, "Unexpected unit");
    }
    return factor;
}

// Duration string to milliseconds
export function parse_duration(duration: string | null) {
    if (duration === null) {
        return null;
    }
    const match = duration.match(duration_regex);
    assert(match);
    if (duration == "perm") {
        return null;
    } else {
        const [_, n, unit] = match;
        return parseInt(n) * parse_unit(unit);
    }
}

// TODO: How notifications work
// TODO: How responses work
// TODO: Stacking

export abstract class ModerationComponent extends BotComponent {
    // Basic moderation component properties: Type, has_duration, persist_moderation
    abstract get type(): moderation_type;

    abstract get past_participle(): string;

    get is_once_off() {
        // Warns and kicks are once-off, they don't have duration and can't be already applied
        return false;
    }

    get persist_moderation() {
        // Mutes and rolepersists need to be persisted, other moderations aren't susceptible to leave+rejoin
        return false;
    }

    // should apply_moderation be a no-op? (useful for development)
    get dummy_rounds() {
        return false;
    }

    // Sorted by moderation end time
    sleep_list: SleepList<mongo.WithId<moderation_entry>, mongo.BSON.ObjectId>;
    timer: NodeJS.Timer | null = null;

    static non_duration_moderation_set = new Set(["warn", "kick", "softban", "note"]);

    static moderations_count = new PromClient.Gauge({
        name: "tccpp_moderations_count",
        help: "tccpp_moderations_count",
        labelNames: ["type"],
    });

    static active_moderations_count = new PromClient.Gauge({
        name: "tccpp_active_moderations_count",
        help: "tccpp_active_moderations_count",
        labelNames: ["type"],
    });

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.sleep_list = new SleepList(this.handle_moderation_expire.bind(this), item => item._id);
        this.wheatley.event_hub.on("update_moderation", (entry: mongo.WithId<moderation_entry>) => {
            this.handle_moderation_update(entry).catch(critical_error);
        });
    }

    update_counters() {
        (async () => {
            ModerationComponent.moderations_count
                .labels({ type: this.type })
                .set(await this.wheatley.database.moderations.countDocuments({ type: this.type }));
            if (!this.is_once_off) {
                ModerationComponent.active_moderations_count
                    .labels({ type: this.type })
                    .set(await this.wheatley.database.moderations.countDocuments({ type: this.type, active: true }));
            }
        })().catch(critical_error);
    }

    override async on_ready() {
        this.update_counters();
        // Handle re-applications and sleep lists
        // If once-off active is false so the rest is all fine
        const moderations = await this.wheatley.database.moderations.find({ type: this.type, active: true }).toArray();
        const moderations_to_sleep = moderations.filter(
            entry => entry.duration !== null || entry.removed || entry.expunged,
        );
        M.debug(
            `Adding moderations to sleep list for ${this.type}`,
            moderations_to_sleep.map(moderation => moderation.case_number),
        );
        // Any catch up will be done in order
        // Handle removed moderations right away
        this.sleep_list.bulk_insert(
            moderations_to_sleep
                .map(entry => {
                    if (entry.removed || entry.expunged) {
                        M.log(entry.issued_at, entry.issued_at < Date.now());
                    }
                    return entry;
                })
                .map(entry =>
                    entry.removed || entry.expunged
                        ? [entry.issued_at, entry]
                        : [entry.issued_at + unwrap(entry.duration), entry],
                ),
        );
        // Persistance:
        await this.ensure_moderations_are_in_place(moderations);
        // Update counters every hour
        set_interval(() => this.update_counters(), HOUR);
    }

    //
    // Basic moderation component interface: Apply, remove, is_applied
    //

    // Add the moderation to the user (e.g. add a role or issue a ban)
    abstract apply_moderation(entry: moderation_entry): Promise<void>;

    // Remove the moderation to the user (e.g. remove a role or unban)
    abstract remove_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;

    // Check if the moderation is in effect
    abstract is_moderation_applied(moderation: basic_moderation_with_user): Promise<boolean>;

    //
    // Moderation events
    //

    async handle_moderation_expire(entry: mongo.WithId<moderation_entry>) {
        assert(!this.is_once_off);
        if (await this.is_moderation_applied(entry)) {
            M.debug("Handling moderation expire", entry);
            await this.remove_moderation(entry);
            this.sleep_list.remove(entry._id);
        } else {
            M.debug("Handling moderation expire - not applied", entry);
        }
        if (entry.removed || entry.expunged) {
            // marked active but removed (can happen from data import)
            const item = unwrap(await this.wheatley.database.moderations.findOne({ _id: entry._id }));
            if (item.active && (item.removed || item.expunged)) {
                await this.wheatley.database.moderations.updateOne(
                    { _id: entry._id },
                    {
                        $set: {
                            active: false,
                        },
                    },
                );
            }
            return;
        }
        // check if moderation is still active, if so resolve it
        if (unwrap(await this.wheatley.database.moderations.findOne({ _id: entry._id })).active) {
            await this.wheatley.database.moderations.updateOne(
                { _id: entry._id },
                {
                    $set: {
                        active: false,
                        removed: {
                            moderator: this.wheatley.id,
                            moderator_name: "Wheatley",
                            reason: "Auto",
                            timestamp: Date.now(),
                        },
                    },
                },
            );
        }
    }

    async handle_moderation_update(entry: mongo.WithId<moderation_entry>) {
        if (entry.type === this.type) {
            M.debug("Handling update for", entry);
            // Update sleep list entry
            if (!this.is_once_off) {
                this.sleep_list.remove(entry._id);
                if (entry.active) {
                    if (entry.duration) {
                        this.sleep_list.insert([entry.issued_at + entry.duration, entry]);
                    }
                    // Entry is active, check if it needs to be applied
                    if (!(await this.is_moderation_applied(entry))) {
                        await this.apply_moderation(entry);
                    }
                } else {
                    // Entry is not active, check if it needs to be removed
                    if (await this.is_moderation_applied(entry)) {
                        await this.remove_moderation(entry);
                    }
                }
            }
        }
    }

    //
    // Persistance
    //

    // called from on_ready to recover from being off
    async ensure_moderations_are_in_place(moderations: mongo.WithId<moderation_entry>[]) {
        // Ensure moderations are in place
        // Go in order of end time
        moderations.sort((a, b) => a.issued_at + (a.duration ?? 0) - (b.issued_at + (b.duration ?? 0)));
        for (const moderation of moderations) {
            try {
                // Only bother if the moderation should in fact still be active, if not it will shortly be deactivated
                // by the sleep list
                // This is important mainly for bans and such in circumstances like the moderation import
                // Allow a short leeway period
                if (moderation.duration && moderation.issued_at + unwrap(moderation.duration) <= Date.now()) {
                    // If end time <= now, moderation is expired
                    await this.wheatley.zelis.send("Skipping ensure_moderations_are_in_place on moderation");
                    M.debug("Skipping ensure_moderations_are_in_place on moderation", moderation);
                    continue;
                }
                // Skip anything that's active but removed
                if (moderation.removed || moderation.expunged) {
                    // If end time <= now, moderation is expired
                    await this.wheatley.zelis.send("Skipping ensure_moderations_are_in_place on removed moderation");
                    M.debug("Skipping ensure_moderations_are_in_place on removed moderation", moderation);
                    continue;
                }
                if (!(await this.is_moderation_applied(moderation))) {
                    M.debug("Reapplying moderation", moderation);
                    await this.apply_moderation(moderation);
                }
            } catch (e) {
                critical_error(e);
            }
        }
    }

    // Address users trying to leave and rejoin
    override async on_guild_member_add(member: Discord.GuildMember) {
        if (this.is_once_off) {
            return;
        }
        const moderations = await this.wheatley.database.moderations
            .find({ user: member.user.id, type: this.type, active: true })
            .toArray();
        for (const moderation of moderations) {
            if (!(await this.is_moderation_applied(moderation))) {
                await this.apply_moderation(moderation);
            }
        }
    }

    //
    // Moderation entry handling
    //

    async get_case_id() {
        return (await this.wheatley.database.get_bot_singleton()).moderation_case_number;
    }

    async increment_case_id() {
        const res = await this.wheatley.database.wheatley.updateOne(
            { id: "main" },
            {
                $inc: {
                    moderation_case_number: 1,
                },
            },
        );
        assert(res.acknowledged);
    }

    static case_id_mutex = new Mutex();

    // Handle applying, adding to the sleep list, inserting into the database, and figuring out the case number
    async issue_moderation(moderation: moderation_entry) {
        try {
            await ModerationComponent.case_id_mutex.lock();
            await this.apply_moderation(moderation);
            moderation.case_number = await this.get_case_id();
            const res = await this.wheatley.database.moderations.insertOne(moderation);
            await this.increment_case_id();
            if (moderation.duration) {
                this.sleep_list.insert([
                    moderation.issued_at + moderation.duration,
                    {
                        _id: res.insertedId,
                        ...moderation,
                    },
                ]);
            }
            this.wheatley.channels.staff_action_log
                .send({
                    embeds: [Modlogs.case_summary(moderation, await this.wheatley.client.users.fetch(moderation.user))],
                })
                .catch(critical_error);
            this.wheatley.event_hub.emit("issue_moderation", moderation);
        } finally {
            ModerationComponent.case_id_mutex.unlock();
        }
    }

    //
    // Notification stuff
    //

    // returns true if unable to dm user
    async notify_user(
        user: Discord.User,
        action: string,
        moderation: DistributedOmit<moderation_entry, "case">,
        is_removal = false,
    ) {
        assert(moderation.type == this.type);
        const duration = moderation.duration ? time_to_human(moderation.duration) : "Permanent";
        try {
            await (
                await user.createDM()
            ).send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setTitle(`You have been ${action} in Together C & C++.`)
                        .setDescription(
                            build_description(
                                is_removal || this.is_once_off ? null : `**Duration:** ${duration}`,
                                moderation.reason ? `**Reason:** ${moderation.reason}` : null,
                                moderation.type === "rolepersist" ? `**Role:** ${moderation.role_name}` : null,
                            ),
                        )
                        .setFooter(
                            is_removal
                                ? null
                                : {
                                      text:
                                          `To appeal this you may open a modmail in Server Guide -> #rules ` +
                                          `or reach out to a staff member.`,
                                  },
                        ),
                ],
            });
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 50007) {
                // 50007: Cannot send messages to this user
                return true;
            } else {
                critical_error(`Error notifying user ${e}`);
                return true;
            }
        }
        return false;
    }

    async do_issue(
        user: Discord.User,
        duration: number, // ms
        reason: string | null,
        basic_moderation_info: basic_moderation,
        link: string | null = null,
    ) {
        const moderation: moderation_entry = {
            ...basic_moderation_info,
            case_number: -1,
            user: user.id,
            user_name: user.displayName,
            moderator: user.id,
            moderator_name: (await this.wheatley.TCCPP.members.fetch(user.id)).displayName,
            reason,
            issued_at: Date.now(),
            duration,
            active: !this.is_once_off,
            removed: null,
            expunged: null,
            link,
        };
        await this.notify_user(user, this.past_participle, moderation);
        await this.issue_moderation(moderation);
    }

    //
    // Command handlers
    //

    async moderation_issue_handler(
        command: TextBasedCommand,
        user: Discord.User,
        duration: string | null,
        reason: string | null,
        basic_moderation_info: basic_moderation,
    ) {
        try {
            if (this.wheatley.is_authorized_mod(user)) {
                // Check if the mod is trying to ban themselves
                if (command.name == "ban" && command.user.id == user.id) {
                    // If the mod is trying to ban themselves then troll them ;)
                    await this.reply_with_error(command, unwrap(get_random_array_element(joke_responses)));
                } else {
                    await this.reply_with_error(command, moderation_on_team_member_message);
                }
                return;
            }
            const base_moderation: basic_moderation_with_user = { ...basic_moderation_info, user: user.id };
            if (!this.is_once_off && (await this.is_moderation_applied(base_moderation))) {
                await this.reply_with_error(command, `User is already ${this.past_participle}`);
                return;
            }
            const moderation: moderation_entry = {
                ...basic_moderation_info,
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: !this.is_once_off,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            const cant_dm = await this.notify_user(user, this.past_participle, moderation);
            await this.issue_moderation(moderation);
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(
                            build_description(
                                `${this.wheatley.success} ***${user.displayName} was ${this.past_participle}***`,
                                command.is_slash() && reason ? `**Reason:** ${reason}` : null,
                                (!this.is_once_off && duration === null) || reason === null
                                    ? `Remember to provide a ${[
                                          !this.is_once_off && duration === null ? "duration" : null,
                                          reason === null ? "reason" : null,
                                      ]
                                          .filter(x => x != null)
                                          .join(" and ")}`
                                    : null,
                                !this.is_once_off && duration !== null ? `**Duration**: ${duration}` : null,
                                cant_dm ? "Note: Couldn't DM user. Their loss." : null,
                            ),
                        )
                        .setFooter({
                            text: `Case ${moderation.case_number}`,
                        }),
                ],
            });
        } catch (e) {
            await this.reply_with_error(command, `Error issuing ${this.type}`);
            critical_error(e);
        }
    }

    async moderation_multi_issue_handler(
        command: TextBasedCommand,
        users: Discord.User[],
        duration: string | null,
        reason: string | null,
        basic_moderation_info: basic_moderation,
    ) {
        try {
            for (const user of users) {
                if (this.wheatley.is_authorized_mod(user)) {
                    await this.reply_with_error(command, moderation_on_team_member_message);
                    continue;
                }
                const base_moderation: basic_moderation_with_user = { ...basic_moderation_info, user: user.id };
                if (!this.is_once_off && (await this.is_moderation_applied(base_moderation))) {
                    await this.reply_with_error(command, `${user.displayName} is already ${this.past_participle}`);
                    continue;
                }
                const moderation: moderation_entry = {
                    ...basic_moderation_info,
                    case_number: -1,
                    user: user.id,
                    user_name: user.displayName,
                    moderator: command.user.id,
                    moderator_name: (await command.get_member()).displayName,
                    reason,
                    issued_at: Date.now(),
                    duration: parse_duration(duration),
                    active: !this.is_once_off,
                    removed: null,
                    expunged: null,
                    link: command.get_or_forge_url(),
                };
                await this.notify_user(user, this.past_participle, moderation);
                await this.issue_moderation(moderation);
            }
            await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(`${this.wheatley.success} ***${capitalize(this.past_participle)} all users***`),
                ],
            });
        } catch (e) {
            await this.reply_with_error(command, `Error issuing multi-${this.type}`);
            critical_error(e);
        }
    }

    async moderation_revoke_handler(
        command: TextBasedCommand,
        user: Discord.User,
        reason: string | null,
        additional_moderation_properties: any = {},
    ) {
        assert(!this.is_once_off);
        try {
            const res = await this.wheatley.database.moderations.findOneAndUpdate(
                { user: user.id, type: this.type, active: true, ...additional_moderation_properties },
                {
                    $set: {
                        active: false,
                        removed: {
                            moderator: command.user.id,
                            moderator_name: (await command.get_member()).displayName,
                            reason: reason,
                            timestamp: Date.now(),
                        },
                    },
                },
                {
                    returnDocument: "after",
                },
            );
            if (!res || !(await this.is_moderation_applied(res))) {
                await this.reply_with_error(command, `User is not ${this.past_participle}`);
            } else {
                await this.remove_moderation(res);
                this.sleep_list.remove(res._id);
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(colors.wheatley)
                            .setDescription(
                                build_description(
                                    `${this.wheatley.success} ***${user.displayName} was un${this.past_participle}***`,
                                    command.is_slash() && reason ? `**Reason:** ${reason}` : null,
                                ),
                            )
                            .setFooter({
                                text: `Case ${res.case_number}`,
                            }),
                    ],
                });
                await this.wheatley.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                            `Case ${res.case_number}: Un${this.past_participle}`,
                        ),
                    ],
                });
            }
        } catch (e) {
            await this.reply_with_error(command, `Error undoing ${this.type}`);
            critical_error(e);
        }
    }

    //
    // Responses
    //

    async reply_with_error(command: TextBasedCommand, message: string) {
        await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.error} ***${message}***`),
            ],
        });
    }
}
