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
 * !warn !delwarn
 * !expunge !unexpunge
 * !noofftopic
 *
 * !reason
 * !duration
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

export type base_moderation_entry = {
    case_number: number;
    user: string;
    user_name: string;
    moderator: string;
    moderator_name: string;
    reason: string | null;
    issued_at: number; // milliseconds since epoch
    duration: number | null; // milliseconds
    active: boolean;
    // TODO: Store a ledger of who alters it?
    removal_mod?: string;
    removal_mod_name?: string;
    removal_timestamp?: number; // milliseconds since epoch
    removal_reason?: string | null;
    expunged?: boolean;
};

export type moderation_entry =
    | (base_moderation_entry & { type: "mute" | "warn" | "ban" | "kick" | "no off-topic" })
    | (base_moderation_entry & { type: "rolepersist"; role: string });

export const duration_regex = /(?:()(perm)\b|(\d+)\s*([mhdwMy]))/;

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
    const [_, n, unit] = match;
    if (n == "" && unit == "perm") {
        return null;
    } else {
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
        this.sleep_list.bulk_insert(
            moderations
                .filter(entry => entry.duration !== null)
                .map(entry => [entry.issued_at + unwrap(entry.duration), entry]),
        );
        // Ensure moderations are in place
        for (const moderation of moderations) {
            try {
                if (!(await this.is_moderation_applied(moderation))) {
                    await this.add_moderation(moderation);
                }
            } catch (e) {
                critical_error(e);
            }
        }
    }

    abstract add_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    abstract remove_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    abstract is_moderation_applied(entry: mongo.WithId<moderation_entry>): Promise<boolean>;

    async handle_moderation_expire(entry: mongo.WithId<moderation_entry>) {
        await this.remove_moderation(entry);
        // remove database entry
        await this.wheatley.database.moderations.updateOne(
            { _id: entry._id },
            {
                $set: {
                    active: false,
                    removal_mod: this.wheatley.id,
                    removal_mod_name: "Wheatley",
                    removal_reason: "Auto",
                    removal_timestamp: Date.now(),
                },
            },
        );
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
            embeds: [new Discord.EmbedBuilder().setColor(colors.red).setTitle("Error").setDescription(message)],
        });
    }

    async notify(command: TextBasedCommand, user: Discord.User, action: string, document: moderation_entry) {
        await (
            await user.createDM()
        ).send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setDescription(
                        `You have been ${action} in Together C & C++.\n` +
                            `Duration: ${document.duration ? time_to_human(document.duration) : "Permanent"}` +
                            `Reason: ${document.reason}\n` +
                            `To appeal this you may open a modmail in Server Guide -> #rules ` +
                            `or reach out to a staff member.`,
                    ),
            ],
        });
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder().setColor(colors.color).setDescription(`${user.displayName} was ${action}`),
            ],
        });
    }
}
