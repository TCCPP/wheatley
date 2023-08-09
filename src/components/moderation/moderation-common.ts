import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { Mutex, SleepList, critical_error, time_to_human, unwrap } from "../../utils.js";
import { BotComponent } from "../../bot-component.js";
import { TextBasedCommand } from "../../command.js";
import { Wheatley } from "../../wheatley.js";

import * as mongo from "mongodb";
import { colors } from "../../common.js";

/*
 * !mute !unmute
 * !ban !unban
 * !kick
 * !rolepersist add/remove
 * !temprole
 * !warn
 * !noofftopic
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
 * Notifications
 * Buttons for !case
 * Link users to modmail for appeals, also include appeal info in dm notifications
 *
 */

export type moderation_type = "mute" | "warn" | "ban" | "kick" | "no off-topic" | "rolepersist";

export type moderation_edit_info = {
    moderator: string;
    moderator_name: string;
    timestamp: number;
    reason: string | null;
};

export type basic_moderation =
    | {
          type: "mute" | "warn" | "ban" | "kick" | "no off-topic";
          user: string; // snowflake
      }
    | {
          type: "rolepersist";
          user: string; // snowflake
          role: string; // snowflake
      };

// TODO: Rename to moderation base?
// TODO: Only increment case id on success.....
// TODO: Indexes: Active, case number, id, user, moderator, type
// TODO: Some system for moderation update events
// TODO: Unneeded eslint-disable-next-line @typescript-eslint/no-unnecessary-condition in wheatley.ts

export type moderation_entry = basic_moderation & {
    case_number: number;
    user_name: string;
    moderator: string; // snowflake
    moderator_name: string;
    reason: string | null;
    issued_at: number; // milliseconds since epoch
    duration: number | null; // milliseconds
    active: boolean; // active and can be deactivated at some point
    removed: moderation_edit_info | null;
    expunged: moderation_edit_info | null;
};

export const duration_regex = /(?:perm\b|(\d+)\s*([mhdwMy]))/;

function parse_unit(u: string) {
    let factor = 1000; // in ms
    switch (u) {
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

export abstract class ModerationComponent extends BotComponent {
    abstract get type(): moderation_type;

    // Sorted by moderation end time
    sleep_list: SleepList<mongo.WithId<moderation_entry>, mongo.BSON.ObjectId>;
    timer: NodeJS.Timer | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.sleep_list = new SleepList(this.handle_moderation_expire.bind(this), item => item._id);
    }

    override async on_ready() {
        const moderations = await this.wheatley.database.moderations.find({ type: this.type, active: true }).toArray();
        // Any catch up will be done in order
        this.sleep_list.bulk_insert(
            moderations
                .filter(entry => entry.duration !== null)
                .map(entry => [entry.issued_at + unwrap(entry.duration), entry]),
        );
        // Ensure moderations are in place
        for (const moderation of moderations.sort(
            (a, b) => a.issued_at + unwrap(a.duration) - (b.issued_at + unwrap(b.duration)),
        )) {
            try {
                if (!(await this.is_moderation_applied(moderation))) {
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
    abstract is_moderation_applied(moderation: basic_moderation): Promise<boolean>;

    async handle_moderation_expire(entry: mongo.WithId<moderation_entry>) {
        if (await this.is_moderation_applied(entry)) {
            await this.remove_moderation(entry);
            this.sleep_list.remove(entry._id);
            // remove database entry
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
        } finally {
            ModerationComponent.case_id_mutex.unlock();
        }
    }

    async reply_with_error(command: TextBasedCommand, message: string) {
        if (command.replied) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setTitle("Error")
                        .setDescription(`<:error:1138616562958483496> ***${message}***`),
                ],
            });
        } else {
            await command.followUp({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setTitle("Error")
                        .setDescription(`<:error:1138616562958483496> ***${message}***`),
                ],
            });
        }
    }

    async notify(
        command: TextBasedCommand,
        user: Discord.User,
        action: string,
        moderation: Omit<moderation_entry, "case">,
        is_removal = false,
    ) {
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setDescription(`<:success:1138616548630745088> ***${user.displayName} was ${action}***`),
            ],
        });
        const duration = moderation.duration ? time_to_human(moderation.duration) : "Permanent";
        try {
            await (
                await user.createDM()
            ).send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.color)
                        .setDescription(
                            `You have been ${action} in Together C & C++.\n` +
                                (is_removal ? "" : `Duration: ${duration}\n`) +
                                `Reason: ${moderation.reason}` +
                                (is_removal
                                    ? ""
                                    : "\n" +
                                      `To appeal this you may open a modmail in Server Guide -> #rules ` +
                                      `or reach out to a staff member.`),
                        ),
                ],
            });
        } catch (e) {
            await this.reply_with_error(command, "Error notifying");
            critical_error(e);
        }
    }
}
