import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { SleepList, critical_error, time_to_human, unwrap } from "../../utils.js";
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
 * !expunge !unexpunge
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

    abstract apply_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    abstract remove_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    abstract is_moderation_applied(moderation: basic_moderation): Promise<boolean>;

    async add_new_moderation(entry: mongo.WithId<moderation_entry>) {
        await this.apply_moderation(entry);
        if (entry.duration) {
            this.sleep_list.insert([entry.issued_at + entry.duration, entry]);
        }
    }

    async handle_moderation_expire(entry: mongo.WithId<moderation_entry>) {
        if (await this.is_moderation_applied(entry)) {
            await this.remove_moderation(entry);
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
        return unwrap(
            (
                await this.wheatley.database.wheatley.findOneAndUpdate(
                    { id: "main" },
                    {
                        $inc: {
                            moderation_case_number: 1,
                        },
                    },
                    {
                        returnDocument: "after",
                    },
                )
            ).value,
        ).moderation_case_number;
    }

    async reply_with_error(command: TextBasedCommand, message: string) {
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setTitle("Error")
                    .setDescription(`<:error:1138616562958483496> ***${message}***`),
            ],
        });
    }

    async notify(
        command: TextBasedCommand,
        user: Discord.User,
        action: string,
        document: moderation_entry,
        show_appeal_info = true,
    ) {
        await (
            await user.createDM()
        ).send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setDescription(
                        `You have been ${action} in Together C & C++.\n` +
                            `Duration: ${document.duration ? time_to_human(document.duration) : "Permanent"}` +
                            `Reason: ${document.reason}` +
                            (show_appeal_info
                                ? "\n" +
                                  `To appeal this you may open a modmail in Server Guide -> #rules ` +
                                  `or reach out to a staff member.`
                                : ""),
                    ),
            ],
        });
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setDescription(`<:success:1138616548630745088> ***${user.displayName} was ${action}***`),
            ],
        });
    }
}
