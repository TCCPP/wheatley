import * as Discord from "discord.js";
import * as mongo from "mongodb";
import PromClient from "prom-client";

import { EventEmitter } from "events";

import { strict as assert } from "assert";

import { M } from "../../../../utils/debugging-and-logging.js";

import { unwrap } from "../../../../utils/misc.js";
import { build_description, capitalize } from "../../../../utils/strings.js";
import { time_to_human } from "../../../../utils/strings.js";
import { DistributedOmit } from "../../../../utils/typing.js";
import { SleepList } from "../../../../utils/containers.js";
import { Mutex } from "../../../../utils/containers.js";
import { BotComponent } from "../../../../bot-component.js";
import { ensure_index } from "../../../../infra/database-interface.js";
import { Wheatley } from "../../../../wheatley.js";
import { channel_map } from "../../../../channel-map.js";
import { wheatley_channels } from "../../channels.js";
import { colors, HOUR, MINUTE } from "../../../../common.js";
import { parse_time_unit } from "../../../../utils/time.js";
import Modlogs, { staff_moderation_display_options, public_moderation_display_options } from "./modlogs.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import {
    moderation_state,
    moderation_type,
    moderation_entry,
    basic_moderation_with_user,
    basic_moderation,
    note_moderation_types,
} from "./schemata.js";
import { set_interval } from "../../../../utils/node.js";

import { get_random_array_element } from "../../../../utils/arrays.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import { BotButton, ButtonInteractionBuilder } from "../../../../command-abstractions/button.js";
import { discord_timestamp } from "../../../../utils/discord.js";
import NotificationThreads from "../notification-threads.js";

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

export const duration_regex = /perm\b|(\d+)\s*([a-zA-Z]+)/;

export const joke_responses_other = ["You have no power over this user :(", "lol, nice try!", "One day, maybe ;)"];
export const joke_responses_self = [
    "You won't get off that easy! ;)",
    "Try again next time lmao",
    "Didn't work. skill issue?",
];

export class ParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ParseError";
    }
}

export type revoke_handler_options = {
    allow_no_entry?: boolean;
};

// Returns the corresponding duration in milliseconds,
// or null for permanent duration.
// Throws ParseError when parsing fails.
export function parse_duration(duration: string) {
    const match = duration.match(duration_regex);
    if (!match) {
        throw new ParseError("Duration does not match expected pattern");
    }
    if (duration === "perm" || duration === "permanent") {
        return null;
    }
    const [_, n, unit] = match;
    const unit_millis = parse_time_unit(unit);
    if (unit_millis === null) {
        throw new ParseError(`Invalid time unit in duration: ${unit}`);
    }
    return parseInt(n) * unit_millis;
}

// Returns the corresponding duration in milliseconds,
// or null for permanent duration (returned if the given duration is null).
// Throws ParseError when parsing fails.
export function parse_nullable_duration(duration: string | null) {
    return duration != null ? parse_duration(duration) : null;
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

    protected database = this.wheatley.database.create_proxy<{
        component_state: moderation_state;
        moderations: moderation_entry;
    }>();
    protected channels = channel_map(
        this.wheatley,
        wheatley_channels.staff_action_log,
        wheatley_channels.public_action_log,
        wheatley_channels.red_telephone_alerts,
        wheatley_channels.rules,
    );
    protected notification_threads!: NotificationThreads;
    private static ring_red_telephone_button_instance: BotButton<[number]> | null = null;
    protected get ring_red_telephone_button() {
        return unwrap(ModerationComponent.ring_red_telephone_button_instance);
    }

    // Sorted by moderation end time
    sleep_list: SleepList<mongo.WithId<moderation_entry>, mongo.BSON.ObjectId>;
    timer: NodeJS.Timer | null = null;

    static non_duration_moderation_set = new Set(["warn", "kick", "softban", "note", "voice_note"]);

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
        this.sleep_list = new SleepList(
            wheatley,
            this.handle_moderation_expire.bind(this),
            item => item._id,
            (a: mongo.BSON.ObjectId, b: mongo.BSON.ObjectId) => a.equals(b),
        );
        this.wheatley.event_hub.on("update_moderation", (entry: mongo.WithId<moderation_entry>) => {
            this.handle_moderation_update(entry).catch(this.wheatley.critical_error.bind(this.wheatley));
        });
    }

    // Critical stuff happens in setup(), it's important extending classes call super here
    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.moderations, { case_number: 1 }, { unique: true });
        await ensure_index(this.wheatley, this.database.moderations, { type: 1, active: 1 });
        await ensure_index(this.wheatley, this.database.moderations, { user: 1, expunged: 1, issued_at: -1 });
        await ensure_index(this.wheatley, this.database.moderations, { user: 1, type: 1, active: 1 });
        await ensure_index(this.wheatley, this.database.moderations, { type: 1, issued_at: -1 });
        await ensure_index(this.wheatley, this.database.component_state, { id: 1 }, { unique: true });

        await this.channels.resolve();
        this.notification_threads = unwrap(this.wheatley.components.get("NotificationThreads")) as NotificationThreads;

        // Only register button handler once across all ModerationComponent instances
        // In effect, the first component to be loaded extending ModerationComponent will be responsible for handling
        // all red telephone button presses, which doesn't feel very elegant but works.
        if (!ModerationComponent.ring_red_telephone_button_instance) {
            ModerationComponent.ring_red_telephone_button_instance = commands.add(
                new ButtonInteractionBuilder("ring_red_telephone")
                    .add_number_metadata()
                    .set_handler(this.handle_ring_red_telephone.bind(this)),
            );
        }
    }

    async handle_ring_red_telephone(interaction: Discord.ButtonInteraction, case_number: number) {
        const moderation = await this.database.moderations.findOne({ case_number });
        if (!moderation) {
            await interaction.reply({
                content: "Error: Could not find moderation case",
                ephemeral: true,
            });
            return;
        }

        const user = await this.wheatley.client.users.fetch(moderation.user);

        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle(`Case ${case_number}`)
            .setAuthor({
                name: moderation.user_name,
                iconURL: user.displayAvatarURL(),
            })
            .setDescription(
                build_description(
                    `**User:** <@${moderation.user}>`,
                    `**Type:** ${moderation.type}`,
                    `**Issued At:** ${discord_timestamp(moderation.issued_at)}`,
                    moderation.duration === null ? null : `**Duration:** ${time_to_human(moderation.duration)}`,
                    `**Reason:** ${moderation.reason ?? "No reason provided"}`,
                ),
            )
            .setFooter({
                text: `ID: ${moderation.user}`,
            });

        await this.channels.red_telephone_alerts.send({ embeds: [embed] });

        await interaction.update({
            components: [
                new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
                    new Discord.ButtonBuilder()
                        .setCustomId(this.ring_red_telephone_button.generate_custom_id(case_number))
                        .setLabel("Sent to Red Telephone ✓")
                        .setStyle(Discord.ButtonStyle.Success)
                        .setDisabled(true),
                ),
            ],
        });
    }

    update_counters() {
        (async () => {
            ModerationComponent.moderations_count
                .labels({ type: this.type })
                .set(await this.database.moderations.countDocuments({ type: this.type }));
            if (!this.is_once_off) {
                ModerationComponent.active_moderations_count
                    .labels({ type: this.type })
                    .set(await this.database.moderations.countDocuments({ type: this.type, active: true }));
            }
        })().catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    override async on_ready() {
        this.update_counters();
        // Handle re-applications and sleep lists
        // If once-off active is false so the rest is all fine
        const moderations = await this.database.moderations.find({ type: this.type, active: true }).toArray();
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

    // Check if the moderation is currently applied in Discord (role present, ban in place, etc.)
    abstract is_moderation_applied_in_discord(moderation: basic_moderation_with_user): Promise<boolean>;

    // Apply revoke action to Discord without an existing moderation entry.
    // Must be overridden in subclasses that use allow_no_entry mode.
    async apply_revoke_to_discord(_member: Discord.GuildMember): Promise<void> {
        throw new Error("apply_revoke_to_discord must be overridden when using allow_no_entry");
    }

    // Check if there are other active moderations of the same type for this user (excluding the given entry)
    async has_other_active_moderations(entry: mongo.WithId<moderation_entry>): Promise<boolean> {
        const query: mongo.Filter<moderation_entry> = {
            user: entry.user,
            type: entry.type,
            active: true,
            _id: { $ne: entry._id },
        };
        if (entry.type === "rolepersist") {
            query.role = entry.role;
        }
        return (await this.database.moderations.countDocuments(query)) > 0;
    }

    // Get all other active moderations of the same type for this user (excluding the given entry)
    async get_remaining_active_moderations(
        entry: mongo.WithId<moderation_entry>,
    ): Promise<mongo.WithId<moderation_entry>[]> {
        const query: mongo.Filter<moderation_entry> = {
            user: entry.user,
            type: entry.type,
            active: true,
            _id: { $ne: entry._id },
        };
        if (entry.type === "rolepersist") {
            query.role = entry.role;
        }
        return await this.database.moderations.find(query).sort({ issued_at: -1 }).toArray();
    }

    // Check if the same moderation type was applied to the user recently and is still active
    async check_for_recent_duplicate(
        user_id: string,
        basic_moderation_info: basic_moderation,
    ): Promise<mongo.WithId<moderation_entry> | null> {
        if (this.is_once_off) {
            return null;
        }
        const query: mongo.Filter<moderation_entry> = {
            user: user_id,
            type: this.type,
            active: true,
            issued_at: { $gt: Date.now() - 5 * MINUTE },
        };
        if (basic_moderation_info.type === "rolepersist") {
            query.role = basic_moderation_info.role;
        }
        return await this.database.moderations.findOne(query);
    }

    //
    // Moderation events
    //

    async handle_moderation_expire(entry_from_sleep: mongo.WithId<moderation_entry>) {
        assert(!this.is_once_off);
        // It's possible the moderation could have been removed or been updated by the time this runs, so fetch the
        // current state
        const entry = unwrap(await this.database.moderations.findOne({ _id: entry_from_sleep._id }));
        // Check for active but removed (can happen from data import)
        if (entry.active && (entry.removed || entry.expunged)) {
            await this.database.moderations.updateOne(
                { _id: entry._id },
                {
                    $set: {
                        active: false,
                    },
                },
            );
            return;
        }
        // Check for time, just as a safety measure
        if (
            !entry.duration ||
            (entry.issued_at + entry.duration > Date.now() + 1000 && !entry.removed && !entry.expunged)
        ) {
            // time may have been extended
            this.wheatley.alert(
                `Somehow handle_moderation_expire fired on a moderation that hasn't expired yet, ` +
                    `${JSON.stringify(entry)}`,
            );
            return;
        }
        // Check if remove logic should be done - only remove from Discord if no other active moderations exist
        const has_other_active = await this.has_other_active_moderations(entry);
        if (await this.is_moderation_applied_in_discord(entry)) {
            M.debug("Handling moderation expire", entry);
            this.sleep_list.remove(entry._id);
            if (!has_other_active) {
                await this.remove_moderation(entry);
            }
            await this.channels.staff_action_log.send({
                embeds: [
                    Modlogs.case_summary(
                        entry,
                        await this.wheatley.client.users.fetch(entry.user),
                        staff_moderation_display_options,
                    )
                        .setTitle(`${capitalize(this.type)} is being lifted (case ${entry.case_number})`)
                        .setDescription(
                            has_other_active
                                ? "Note: Other active moderation exists, not removing moderation in discord"
                                : null,
                        ),
                ],
            });
        } else {
            M.debug("Handling moderation expire - not applied", entry);
        }
        // Check if moderation is still marked active, if so resolve it
        if (entry.active) {
            await this.database.moderations.updateOne(
                { _id: entry._id },
                {
                    $set: {
                        active: false,
                        removed: {
                            moderator: this.wheatley.user.id,
                            moderator_name: "Wheatley",
                            reason: "Auto",
                            timestamp: Date.now(),
                        },
                        auto_removed: true,
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
                    if (!(await this.is_moderation_applied_in_discord(entry))) {
                        M.debug("Moderation wasn't applied, applying", entry.case_number);
                        await this.apply_moderation(entry);
                    }
                } else {
                    // Entry is not active, check if it needs to be removed
                    // Only remove from Discord if no other active moderations exist
                    const has_other_active = await this.has_other_active_moderations(entry);
                    if (!has_other_active && (await this.is_moderation_applied_in_discord(entry))) {
                        M.debug("Moderation was applied, removing", entry.case_number);
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
                    this.wheatley.alert("Skipping ensure_moderations_are_in_place on expired moderation");
                    M.debug("Skipping ensure_moderations_are_in_place on expired moderation", moderation);
                    continue;
                }
                // Skip anything that's active but removed
                if (moderation.removed || moderation.expunged) {
                    // If end time <= now, moderation is expired
                    this.wheatley.alert("Skipping ensure_moderations_are_in_place on removed moderation");
                    M.debug("Skipping ensure_moderations_are_in_place on removed moderation", moderation);
                    continue;
                }
                if (!(await this.is_moderation_applied_in_discord(moderation))) {
                    M.debug("Reapplying moderation", moderation);
                    await this.apply_moderation(moderation);
                }
            } catch (e) {
                this.wheatley.critical_error(e);
            }
        }
    }

    // Address users trying to leave and rejoin
    override async on_guild_member_add(member: Discord.GuildMember) {
        if (member.guild.id !== this.wheatley.guild.id) {
            return;
        }
        if (this.is_once_off) {
            return;
        }
        const moderations = await this.database.moderations
            .find({ user: member.user.id, type: this.type, active: true })
            .toArray();
        for (const moderation of moderations) {
            if (!(await this.is_moderation_applied_in_discord(moderation))) {
                await this.apply_moderation(moderation);
            }
        }
    }

    //
    // Moderation entry handling
    //

    async increment_case_id() {
        const res = await this.database.component_state.findOneAndUpdate(
            { id: "moderation" },
            {
                $inc: {
                    case_number: 1,
                },
            },
            { upsert: true, returnDocument: "after" },
        );
        return unwrap(res).case_number;
    }

    static case_id_mutex = new Mutex();

    // Handle applying, adding to the sleep list, inserting into the database, and figuring out the case number
    async issue_moderation(moderation: moderation_entry) {
        try {
            await ModerationComponent.case_id_mutex.lock();
            await this.apply_moderation(moderation);
            moderation.case_number = await this.increment_case_id();
            const res = await this.database.moderations.insertOne(moderation);
            if (moderation.duration) {
                this.sleep_list.insert([
                    moderation.issued_at + moderation.duration,
                    {
                        _id: res.insertedId,
                        ...moderation,
                    },
                ]);
            }
            const message_options: Discord.MessageCreateOptions = {
                embeds: [
                    Modlogs.case_summary(
                        moderation,
                        await this.wheatley.client.users.fetch(moderation.user),
                        staff_moderation_display_options,
                    ),
                ],
            };
            // Only include the red telephone button if this is not an automatic moderation
            if (moderation.moderator !== this.wheatley.user.id) {
                message_options.components = [
                    new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
                        new Discord.ButtonBuilder()
                            .setCustomId(this.ring_red_telephone_button.generate_custom_id(moderation.case_number))
                            .setLabel("Ring the Red Telephone")
                            .setStyle(Discord.ButtonStyle.Secondary)
                            .setEmoji("📞"),
                    ),
                ];
            }
            this.channels.staff_action_log
                .send(message_options)
                .catch(this.wheatley.critical_error.bind(this.wheatley));
            if (!note_moderation_types.includes(moderation.type)) {
                this.channels.public_action_log
                    .send({
                        embeds: [
                            Modlogs.case_summary(
                                moderation,
                                await this.wheatley.client.users.fetch(moderation.user),
                                public_moderation_display_options,
                            ),
                        ],
                    })
                    .catch(this.wheatley.critical_error.bind(this.wheatley));
            }
            this.wheatley.event_hub.emit("issue_moderation", moderation);
        } finally {
            ModerationComponent.case_id_mutex.unlock();
        }
    }

    //
    // Notification stuff
    //

    // returns true if able to notify user (via DM or thread fallback)
    async notify_user(
        user: Discord.User,
        action: string,
        moderation: DistributedOmit<moderation_entry, "case">,
        is_removal = false,
    ) {
        assert(moderation.type == this.type);
        const duration = moderation.duration ? time_to_human(moderation.duration) : "Permanent";
        const message: Discord.MessageCreateOptions = {
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle(`You have been ${action} in ${this.wheatley.guild.name}.`)
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
        };
        return await this.notification_threads.notify_user_with_thread_fallback(
            this.channels.rules,
            user,
            message,
            "Moderation Notification",
        );
    }

    async issue_moderation_internal(
        user: Discord.User,
        moderator: Discord.User,
        duration: number, // ms
        reason: string | null,
        basic_moderation_info: basic_moderation,
        link: string | null = null,
    ) {
        const recent_duplicate = await this.check_for_recent_duplicate(user.id, basic_moderation_info);
        if (recent_duplicate) {
            this.wheatley.warn(
                `Automatically issued moderation not applied due to duplicating a recent moderation. ` +
                    `reason=${reason} info=${JSON.stringify(basic_moderation_info)}`,
            );
            return;
        }
        const moderation: moderation_entry = {
            ...basic_moderation_info,
            case_number: -1,
            user: user.id,
            user_name: user.displayName,
            moderator: moderator.id,
            moderator_name: (await this.wheatley.guild.members.fetch(moderator.id)).displayName,
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
        duration_string: string | null,
        reason: string | null,
        basic_moderation_info: basic_moderation,
    ) {
        try {
            const target = await this.wheatley.try_fetch_guild_member(user);
            const issuer = unwrap(await this.wheatley.try_fetch_guild_member(command.user));
            if (target && target.roles.highest.position >= issuer.roles.highest.position) {
                if (
                    command.user.id == user.id &&
                    (basic_moderation_info.type == "ban" || basic_moderation_info.type == "kick")
                ) {
                    // Mod is trying to ban/kick themselves => troll them ;)
                    await this.reply_with_error(command, unwrap(get_random_array_element(joke_responses_self)));
                    return;
                }
                // Mod is trying to ban/kick above their paygrade => troll them :D
                await this.reply_with_error(command, unwrap(get_random_array_element(joke_responses_other)));
                return;
            }
            const recent_duplicate = await this.check_for_recent_duplicate(user.id, basic_moderation_info);
            if (recent_duplicate) {
                const time_ago = time_to_human(Date.now() - recent_duplicate.issued_at);
                await this.reply_with_error(
                    command,
                    `User was ${this.past_participle} recently ` +
                        `(case ${recent_duplicate.case_number}, ${time_ago} ago by ${recent_duplicate.moderator_name})`,
                );
                return;
            }
            const duration = parse_nullable_duration(duration_string);
            const moderation: moderation_entry = {
                ...basic_moderation_info,
                case_number: -1,
                user: user.id,
                user_name: user.displayName,
                moderator: command.user.id,
                moderator_name: (await command.get_member()).displayName,
                reason,
                issued_at: Date.now(),
                duration,
                active: !this.is_once_off,
                removed: null,
                expunged: null,
                link: command.get_or_forge_url(),
            };
            const is_note_type = note_moderation_types.includes(this.type);
            const notification_failed = await (async () => {
                if (!is_note_type) {
                    return !(await this.notify_user(user, this.past_participle, moderation));
                } else {
                    return false;
                }
            })();
            await this.issue_moderation(moderation);
            const success_message = is_note_type
                ? `Note added for ${user.displayName}`
                : `${user.displayName} was ${this.past_participle}`;
            const reason_line = (() => {
                if (!command.is_slash() || !reason) {
                    return null;
                }
                return is_note_type ? `**Note:** ${reason}` : `**Reason:** ${reason}`;
            })();
            await command.reply({
                content:
                    basic_moderation_info.type === "ban"
                        ? `"This is the part where I kill you" — ${this.wheatley.emoji.me}`
                        : undefined,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(
                            build_description(
                                `${this.wheatley.emoji.success} ***${success_message}***`,
                                reason_line,
                                (!this.is_once_off && duration_string === null) || reason === null
                                    ? `Remember to provide a ${[
                                          !this.is_once_off && duration_string === null ? "duration" : null,
                                          reason === null ? "reason" : null,
                                      ]
                                          .filter(x => x != null)
                                          .join(" and ")}`
                                    : null,
                                !this.is_once_off && duration_string !== null
                                    ? `**Duration**: ${duration == null ? "permanent" : time_to_human(duration)}`
                                    : null,
                                notification_failed
                                    ? "Note: Couldn't notify user (DM and thread fallback both failed)."
                                    : null,
                            ),
                        )
                        .setFooter({
                            text: `Case ${moderation.case_number}`,
                        }),
                ],
                ephemeral_if_possible: is_note_type,
            });
        } catch (e) {
            if (e instanceof ParseError) {
                await this.reply_with_error(command, e.message);
            } else {
                await this.reply_with_error(command, `Error issuing ${this.type}`);
                this.wheatley.critical_error(e);
            }
        }
    }

    async moderation_multi_issue_handler(
        command: TextBasedCommand,
        users: Discord.User[],
        duration_string: string | null,
        reason: string | null,
        basic_moderation_info: basic_moderation,
    ) {
        try {
            const issuer = unwrap(await this.wheatley.try_fetch_guild_member(command.user));
            for (const user of users) {
                const target = await this.wheatley.try_fetch_guild_member(user);
                if (target && target.roles.highest.position >= issuer.roles.highest.position) {
                    await this.reply_with_error(command, unwrap(get_random_array_element(joke_responses_other)));
                    continue;
                }
                const recent_duplicate = await this.check_for_recent_duplicate(user.id, basic_moderation_info);
                if (recent_duplicate) {
                    await command.replyOrFollowUp({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(colors.alert_color)
                                .setDescription(
                                    `${this.wheatley.emoji.error} ***Skipping ${user.displayName}: was recently ` +
                                        `${this.past_participle} (case ${recent_duplicate.case_number})***`,
                                ),
                        ],
                    });
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
                    duration: parse_nullable_duration(duration_string),
                    active: !this.is_once_off,
                    removed: null,
                    expunged: null,
                    link: command.get_or_forge_url(),
                };
                await this.notify_user(user, this.past_participle, moderation);
                await this.issue_moderation(moderation);
            }
            await command.replyOrFollowUp({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(
                            `${this.wheatley.emoji.success} ***${capitalize(this.past_participle)} all users***`,
                        ),
                ],
            });
        } catch (e) {
            if (e instanceof ParseError) {
                await this.reply_with_error(command, e.message);
                return;
            }
            await this.reply_with_error(command, `Error issuing multi-${this.type}`);
            this.wheatley.critical_error(e);
        }
    }

    async moderation_revoke_handler(
        command: TextBasedCommand,
        user: Discord.User,
        reason: string | null,
        additional_moderation_properties: any = {},
        options: revoke_handler_options = {},
    ) {
        assert(!this.is_once_off);
        try {
            const res = await this.database.moderations.findOneAndUpdate(
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
                    sort: { issued_at: -1 },
                },
            );
            if (!res && options.allow_no_entry) {
                const member = await this.wheatley.try_fetch_guild_member(user);
                if (member) {
                    await this.apply_revoke_to_discord(member);
                }
                const message =
                    `${this.wheatley.emoji.success} ` + `***${user.displayName} was un${this.past_participle}***`;
                await command.reply({
                    embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setDescription(message)],
                });
            } else if (!res) {
                await this.reply_with_error(command, `User is not ${this.past_participle}`);
            } else {
                this.sleep_list.remove(res._id);
                // Only remove from Discord if no other active moderations exist
                const remaining_moderations = await this.get_remaining_active_moderations(res);
                const has_other_active = remaining_moderations.length > 0;
                if (!has_other_active) {
                    await this.remove_moderation(res);
                }
                const remaining_message = has_other_active
                    ? `Note: ${remaining_moderations.length} other active ${this.type}(s) still applied: ` +
                      remaining_moderations.map(m => `case ${m.case_number}`).join(", ")
                    : null;
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(colors.wheatley)
                            .setDescription(
                                build_description(
                                    `${this.wheatley.emoji.success} ` +
                                        `***${user.displayName} was un${this.past_participle}***`,
                                    command.is_slash() && reason ? `**Reason:** ${reason}` : null,
                                    remaining_message,
                                ),
                            )
                            .setFooter({
                                text: `Removed case ${res.case_number}`,
                            }),
                    ],
                });
                await this.channels.staff_action_log.send({
                    embeds: [
                        Modlogs.case_summary(
                            res,
                            await this.wheatley.client.users.fetch(res.user),
                            staff_moderation_display_options,
                        )
                            .setTitle(`Removed case ${res.case_number}: Un${this.past_participle}`)
                            .setDescription(remaining_message),
                    ],
                });
                if (!note_moderation_types.includes(res.type)) {
                    await this.channels.public_action_log.send({
                        embeds: [
                            Modlogs.case_summary(
                                res,
                                await this.wheatley.client.users.fetch(res.user),
                                public_moderation_display_options,
                            ).setTitle(`Removed case ${res.case_number}: Un${this.past_participle}`),
                        ],
                    });
                }
            }
        } catch (e) {
            await this.reply_with_error(command, `Error undoing ${this.type}`);
            this.wheatley.critical_error(e);
        }
    }

    //
    // Responses
    //

    async reply_with_error(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.emoji.error} ***${message}***`),
            ],
        });
    }
}
