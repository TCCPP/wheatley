import * as Discord from "discord.js";
import * as mongo from "mongodb";
import { EventEmitter } from "events";

import { strict as assert } from "assert";

import { unwrap } from "../../utils/misc.js";
import { build_description, capitalize } from "../../utils/strings.js";
import { time_to_human } from "../../utils/strings.js";
import { DistributedOmit } from "../../utils/typing.js";
import { SleepList } from "../../utils/containers.js";
import { critical_error } from "../../utils/debugging-and-logging.js";
import { Mutex } from "../../utils/containers.js";
import { M } from "../../utils/debugging-and-logging.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { colors } from "../../common.js";
import Modlogs from "./modlogs.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";

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

export type moderation_type = "mute" | "warn" | "ban" | "kick" | "rolepersist" | "timeout";

export type moderation_edit_info = {
    moderator: string;
    moderator_name: string;
    timestamp: number;
    reason: string | null;
};

export type basic_moderation =
    | {
          type: Exclude<moderation_type, "rolepersist">;
      }
    | {
          type: "rolepersist";
          role: string; // snowflake
          role_name: string;
      };

export type basic_moderation_with_user = basic_moderation & { user: string };

// TODO: Rename to moderation base?

// Indexes: ID, type, case number, user, moderator, active
export type moderation_entry = basic_moderation & {
    case_number: number;
    user: string; // snowflake
    user_name: string;
    moderator: string; // snowflake
    moderator_name: string;
    reason: string | null;
    issued_at: number; // milliseconds since epoch
    duration: number | null; // milliseconds
    active: boolean; // active and can be deactivated at some point
    removed: moderation_edit_info | null;
    expunged: moderation_edit_info | null;
    link: string | null;
};

export const duration_regex = /(?:perm\b|(\d+)\s*([mhdwMys]))/;

export const moderation_on_team_member_message: string = "Can't apply this moderation on team members";

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

export async function reply_with_error(command: TextBasedCommand, message: string) {
    await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
        embeds: [
            new Discord.EmbedBuilder()
                .setColor(colors.alert_color)
                .setDescription(`<:error:1138616562958483496> ***${message}***`),
        ],
    });
}

export async function reply_with_success(command: TextBasedCommand, message: string, extra?: string) {
    await command.reply({
        embeds: [
            new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setDescription(`<:success:1138616548630745088> ***${message}***${extra ? " " + extra : ""}`),
        ],
    });
}

export async function reply_with_success_action(
    command: TextBasedCommand,
    user: Discord.User,
    action: string,
    remind_to_duration: boolean,
    remind_to_reason: boolean,
    case_number?: number,
) {
    const reminders = build_description(
        remind_to_duration ? "**Remember to provide a duration with !duration**" : null,
        remind_to_reason ? "**Remember to provide a reason with !reason**" : null,
    );
    await reply_with_success(
        command,
        `${user.displayName} was ${action}`,
        (case_number !== undefined ? `(case ${case_number})` : "") + reminders === "" ? "" : "\n\n" + reminders,
    );
}

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

    // Sorted by moderation end time
    sleep_list: SleepList<mongo.WithId<moderation_entry>, mongo.BSON.ObjectId>;
    timer: NodeJS.Timer | null = null;

    // moderation_update(mongo.WithId<moderation_entry>)
    static event_hub = new EventEmitter();

    static non_duration_moderation_set = new Set(["warn", "kick"]);

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.sleep_list = new SleepList(this.handle_moderation_expire.bind(this), item => item._id);
        ModerationComponent.event_hub.on("moderation_update", (entry: mongo.WithId<moderation_entry>) => {
            this.handle_moderation_update(entry).catch(critical_error);
        });
    }

    override async on_ready() {
        // Handle re-applications and sleep lists
        // If once-off active is false so the rest is all fine
        const moderations = await this.wheatley.database.moderations.find({ type: this.type, active: true }).toArray();
        M.debug(
            `Adding moderations to sleep list for ${this.type}`,
            moderations.map(moderation => moderation.case_number),
        );
        // Any catch up will be done in order
        this.sleep_list.bulk_insert(
            moderations
                .filter(entry => entry.duration !== null)
                .map(entry => [entry.issued_at + unwrap(entry.duration), entry]),
        );
        // Persistance:
        await this.ensure_moderations_are_in_place(moderations);
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
        } finally {
            ModerationComponent.case_id_mutex.unlock();
        }
    }

    //
    // Notification stuff
    //

    async notify_user(
        command: TextBasedCommand,
        user: Discord.User,
        action: string,
        moderation: DistributedOmit<moderation_entry, "case">,
        is_removal = false,
    ) {
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
                                is_removal || ModerationComponent.non_duration_moderation_set.has(moderation.type)
                                    ? null
                                    : `**Duration:** ${duration}`,
                                `**Reason:** ${moderation.reason}`,
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
            await reply_with_error(command, "Error notifying");
            critical_error(e);
        }
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
                await reply_with_error(command, moderation_on_team_member_message);
                return;
            }
            const base_moderation: basic_moderation_with_user = { ...basic_moderation_info, user: user.id };
            if (!this.is_once_off && (await this.is_moderation_applied(base_moderation))) {
                await reply_with_error(command, `User is already ${this.past_participle}`);
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
            await this.notify_user(command, user, this.past_participle, moderation);
            await this.issue_moderation(moderation);
            await reply_with_success_action(
                command,
                user,
                this.past_participle,
                this.is_once_off ? false : duration === null,
                reason === null,
                moderation.case_number,
            );
        } catch (e) {
            await reply_with_error(command, `Error issuing ${this.type}`);
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
                    await reply_with_error(command, moderation_on_team_member_message);
                    continue;
                }
                const base_moderation: basic_moderation_with_user = { ...basic_moderation_info, user: user.id };
                if (!this.is_once_off && (await this.is_moderation_applied(base_moderation))) {
                    await reply_with_error(command, `${user.displayName} is already ${this.past_participle}`);
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
                await this.notify_user(command, user, this.past_participle, moderation);
                await this.issue_moderation(moderation);
            }
            await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(
                            `<:success:1138616548630745088> ***${capitalize(this.past_participle)} all users***`,
                        ),
                ],
            });
        } catch (e) {
            await reply_with_error(command, `Error issuing multi-${this.type}`);
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
                await reply_with_error(command, `User is not ${this.past_participle}`);
            } else {
                await this.remove_moderation(res);
                this.sleep_list.remove(res._id);
                await reply_with_success_action(command, user, `un${this.past_participle}`, false, false);
                await this.wheatley.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(res, await this.wheatley.client.users.fetch(res.user)).setTitle(
                            `Case ${res.case_number}: Un${this.past_participle}`,
                        ),
                    ],
                });
            }
        } catch (e) {
            await reply_with_error(command, `Error undoing ${this.type}`);
            critical_error(e);
        }
    }
}
