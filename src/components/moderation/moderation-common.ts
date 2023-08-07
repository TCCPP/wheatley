import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { critical_error, unwrap } from "../../utils.js";
import { BotComponent } from "../../bot-component.js";
import { TextBasedCommand } from "../../command.js";
import { Wheatley } from "../../wheatley.js";

import * as mongo from "mongodb";

export type moderation_type = "mute" | "warn" | "ban" | "kick" | "no off-topic" | "rolepersist";

export type moderation_entry = {
    case_number: number;
    user: string;
    user_name: string;
    moderator: string;
    moderator_name: string;
    type: moderation_type;
    reason: string | null;
    issued_at: number; // milliseconds since epoch
    duration: number; // milliseconds
    active: boolean;
    removal_mod?: string;
    removal_mod_name?: string;
    removal_timestamp?: number; // milliseconds since epoch
    removal_reason?: string | null;
};

export const duration_regex = /(?:perm\b|\d+\s*[mhdwMy])/;

const INT_MAX = 0x7fffffff;

export function parse_duration(duration: string) {
    // TODO
    return 0;
}

export abstract class ModerationComponent extends BotComponent {
    abstract get type(): moderation_type;

    // Sorted by moderation end time
    sleep_list: mongo.WithId<moderation_entry>[] = [];
    timer: NodeJS.Timer | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        // TODO: Implement catch-up / ensuring moderations are in place
        const moderations = await this.wheatley.database.moderations.find({ type: "mute", active: true }).toArray();
        if (moderations.length > 0) {
            this.sleep_list = moderations.sort((a, b) => a.issued_at + a.duration - (b.issued_at + b.duration));
            this.set_timer();
        }
    }

    async handle_timer() {
        this.timer = null;
        try {
            // sanity checks
            assert(this.sleep_list.length > 0);
            if (this.sleep_list[0].issued_at + this.sleep_list[0].duration > Date.now()) {
                // can happen under excessively long sleeps
                assert(this.sleep_list[0].duration > INT_MAX);
                this.set_timer(); // set next timer
                return;
            }
            // pop entry and remove role
            const entry = this.sleep_list.shift()!;
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
            // reschedule, intentionally not rescheduling
            if (this.sleep_list.length > 0) {
                this.set_timer();
            }
        } catch (e) {
            critical_error(e);
        }
    }

    abstract add_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;
    abstract remove_moderation(entry: mongo.WithId<moderation_entry>): Promise<void>;

    set_timer() {
        assert(this.timer == null);
        assert(this.sleep_list.length > 0);
        const next = this.sleep_list[0];
        // next.issued_at + next.duration - Date.now() but make sure overflow is prevented
        const sleep_time = next.issued_at - Date.now() + next.duration;
        this.timer = setTimeout(
            () => {
                this.handle_timer().catch(critical_error);
            },
            Math.min(sleep_time, INT_MAX),
        );
    }

    async register_moderation(moderation: mongo.WithId<moderation_entry>) {
        // TODO
        void 0;
    }

    async moderation_handler(command: TextBasedCommand, user: Discord.User, duration: string, reason: string) {
        // TODO: Permissions?
        try {
            await this.wheatley.database.lock();
            const case_number = unwrap(
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
            const member = await this.wheatley.TCCPP.members.fetch(command.user.id);
            const document: moderation_entry = {
                case_number,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: member.displayName,
                type: this.type,
                reason,
                issued_at: Date.now(),
                duration: parse_duration(duration),
                active: true,
            };
            const res = await this.wheatley.database.moderations.insertOne(document);
            await this.add_moderation({
                _id: res.insertedId,
                ...document,
            });
            await this.register_moderation({
                _id: res.insertedId,
                ...document,
            });
        } finally {
            this.wheatley.database.unlock();
        }
    }
}
