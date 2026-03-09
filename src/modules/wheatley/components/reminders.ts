import * as Discord from "discord.js";
import * as mongo from "mongodb";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { SleepList } from "../../../utils/containers.js";
import { parse_time_input, TimeParseError } from "../../../utils/time.js";
import { discord_timestamp } from "../../../utils/discord.js";
import { colors } from "../../../common.js";
import { unwrap } from "../../../utils/misc.js";
import { Wheatley } from "../../../wheatley.js";

type reminder_entry = {
    _id: mongo.ObjectId;
    user: string;
    message: string;
    fire_at: number;
    channel_id: string;
    created_at: number;
    created_by: string;
    is_moderator_reminder: boolean;
};

export default class Reminders extends BotComponent {
    private readonly sleep_list: SleepList<reminder_entry, string>;

    private readonly database = this.wheatley.database.create_proxy<{
        reminders: reminder_entry;
    }>();

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.sleep_list = new SleepList<reminder_entry, string>(this.wheatley, this.handle_reminder.bind(this), entry =>
            entry._id.toString(),
        );
    }

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.reminders, { user: 1 });
        await ensure_index(this.wheatley, this.database.reminders, { fire_at: 1 });

        commands.add(
            new TextBasedCommandBuilder("remindme", EarlyReplyMode.visible)
                .set_category("Utility")
                .set_description("Set a reminder for yourself")
                .add_string_option({
                    title: "time",
                    description: "When to remind (e.g., 30m, 3h, 1d, 1w, or 2026-06-01)",
                    required: true,
                })
                .add_string_option({
                    title: "message",
                    description: "What to remind you about",
                    required: true,
                })
                .set_handler(this.remindme.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("remind", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Set a reminder for a user")
                .add_user_option({
                    title: "user",
                    description: "User to remind",
                    required: true,
                })
                .add_string_option({
                    title: "time",
                    description: "When to remind (e.g., 30m, 3h, 1d, 1w, or 2026-06-01)",
                    required: true,
                })
                .add_string_option({
                    title: "message",
                    description: "What to remind them about",
                    required: true,
                })
                .set_handler(this.remind.bind(this)),
        );
    }

    override async on_ready() {
        const reminders: [number, reminder_entry][] = [];
        for await (const reminder of this.database.reminders.find()) {
            reminders.push([reminder.fire_at, reminder]);
        }
        if (reminders.length > 0) {
            this.sleep_list.bulk_insert(reminders);
        }
    }

    private async handle_reminder(entry: reminder_entry) {
        M.log("Handling reminder", entry);
        const embed = new Discord.EmbedBuilder()
            .setTitle("Reminder")
            .setColor(colors.wheatley)
            .setDescription(entry.message)
            .setFooter({ text: `Set ${discord_timestamp(entry.created_at, "R")}` });
        let dm_success = false;
        try {
            const user = await this.wheatley.client.users.fetch(entry.user);
            await user.send({ embeds: [embed] });
            dm_success = true;
        } catch (error) {
            if (error instanceof Discord.DiscordAPIError && (error.code === 50007 || error.code === 50278)) {
                M.debug("Cannot DM user for reminder, falling back to channel mention");
            } else {
                this.wheatley.critical_error("Error sending reminder DM:", error as Error);
            }
        }
        if (!dm_success) {
            try {
                const channel = await this.wheatley.client.channels.fetch(entry.channel_id);
                if (channel && channel.isTextBased() && !(channel instanceof Discord.PartialGroupDMChannel)) {
                    await channel.send({
                        content: `<@${entry.user}>`,
                        embeds: [embed],
                        allowedMentions: { users: [entry.user] },
                    });
                }
            } catch (error) {
                this.wheatley.critical_error("Error sending reminder to fallback channel:", error as Error);
            }
        }
        await this.database.reminders.deleteOne({ _id: entry._id });
    }

    private async remindme(command: TextBasedCommand, time_str: string, message: string) {
        M.debug("Received !remindme", command.user.id, command.user.tag, time_str, message);
        let fire_at: number;
        try {
            fire_at = parse_time_input(time_str);
        } catch (error) {
            if (error instanceof TimeParseError) {
                await command.reply(error.message, true, true);
                return;
            }
            throw error;
        }
        if (fire_at <= Date.now()) {
            await command.reply("Reminder time must be in the future", true, true);
            return;
        }
        const channel_id = unwrap(command.channel).id;
        const entry: reminder_entry = {
            _id: new mongo.ObjectId(),
            user: command.user.id,
            message,
            fire_at,
            channel_id,
            created_at: Date.now(),
            created_by: command.user.id,
            is_moderator_reminder: false,
        };
        await this.database.reminders.insertOne(entry);
        this.sleep_list.insert([fire_at, entry]);
        await command.reply(`I'll remind you ${discord_timestamp(fire_at, "R")} (${discord_timestamp(fire_at, "f")})`);
    }

    private async remind(command: TextBasedCommand, user: Discord.User, time_str: string, message: string) {
        M.debug("Received !remind", command.user.id, command.user.tag, user.id, user.tag, time_str, message);
        let fire_at: number;
        try {
            fire_at = parse_time_input(time_str);
        } catch (error) {
            if (error instanceof TimeParseError) {
                await command.reply(error.message, true, true);
                return;
            }
            throw error;
        }
        if (fire_at <= Date.now()) {
            await command.reply("Reminder time must be in the future", true, true);
            return;
        }
        const channel_id = unwrap(command.channel).id;
        const entry: reminder_entry = {
            _id: new mongo.ObjectId(),
            user: user.id,
            message,
            fire_at,
            channel_id,
            created_at: Date.now(),
            created_by: command.user.id,
            is_moderator_reminder: true,
        };
        await this.database.reminders.insertOne(entry);
        this.sleep_list.insert([fire_at, entry]);
        await command.reply(
            `I'll remind ${user} ${discord_timestamp(fire_at, "R")} (${discord_timestamp(fire_at, "f")})`,
        );
    }
}
