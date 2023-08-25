import * as Discord from "discord.js";
import * as mongo from "mongodb";
import { EventEmitter } from "events";

import { strict as assert } from "assert";

import { M, Mutex, SleepList, build_description, critical_error, time_to_human, unwrap } from "../../utils.js";
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

export type moderation_type = "mute" | "warn" | "ban" | "kick" | "no off-topic" | "rolepersist" | "timeout";

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

export function parse_duration(duration: string) {
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
    case_number?: number,
) {
    await reply_with_success(
        command,
        `${user.displayName} was ${action}`,
        case_number !== undefined ? `(case ${case_number})` : undefined,
    );
}

export abstract class ModerationComponent extends BotComponent {
    abstract get type(): moderation_type;

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
        // Ensure moderations are in place
        for (const moderation of moderations.sort(
            (a, b) => a.issued_at + (a.duration ?? 0) - (b.issued_at + (b.duration ?? 0)),
        )) {
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
        const moderations = await this.wheatley.database.moderations
            .find({ user: member.user.id, type: this.type, active: true })
            .toArray();
        for (const moderation of moderations) {
            if (!(await this.is_moderation_applied(moderation))) {
                await this.apply_moderation(moderation);
            }
        }
    }

    // Add the moderation to the user (e.g. add a role or issue a ban)
    abstract apply_moderation(entry: moderation_entry): Promise<void>;
    // Remove the moderation to the user (e.g. remove a role or unban)
    abstract remove_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    // Check if the moderation is in effect
    abstract is_moderation_applied(moderation: basic_moderation_with_user): Promise<boolean>;

    async handle_moderation_expire(entry: mongo.WithId<moderation_entry>) {
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
    async register_new_moderation(moderation: moderation_entry) {
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

    async notify_user(
        command: TextBasedCommand,
        user: Discord.User,
        action: string,
        moderation: Omit<moderation_entry, "case">,
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
                            build_description([
                                is_removal || ModerationComponent.non_duration_moderation_set.has(moderation.type)
                                    ? null
                                    : `**Duration:** ${duration}`,
                                `**Reason:** ${moderation.reason}`,
                            ]),
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

    async reply_and_notify(
        command: TextBasedCommand,
        user: Discord.User,
        action: string,
        moderation: moderation_entry,
        is_removal = false,
    ) {
        await reply_with_success_action(command, user, action, is_removal ? undefined : moderation.case_number);
        await this.notify_user(command, user, action, moderation, is_removal);
    }
}
