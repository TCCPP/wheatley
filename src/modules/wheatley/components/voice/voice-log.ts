import * as Discord from "discord.js";

import { colors, WEEK } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import {
    CommandAbstractionReplyOptions,
    TextBasedCommand,
} from "../../../../command-abstractions/text-based-command.js";
import { BotButton, ButtonInteractionBuilder } from "../../../../command-abstractions/button.js";
import { SelfClearingMap } from "../../../../utils/containers.js";
import { discord_timestamp } from "../../../../utils/discord.js";
import { create_error_reply } from "../../../../wheatley.js";

type voice_log_event_kind = "join" | "leave";

type voice_log_event = {
    kind: voice_log_event_kind;
    guild_id: string;
    channel_id: string;
    user_id: string;
    at_ms: number;
    other_channel_id: string | null;
    display_name: string;
    username: string;
};

const JOIN_HISTORY_WINDOW = WEEK;
const JOIN_HISTORY_TTL = 2 * WEEK;
const JOIN_HISTORY_MAX_ENTRIES_PER_CHANNEL = 200;
const JOIN_HISTORY_MAX_N_OUTPUT = 200;
const JOIN_HISTORY_PAGE_SIZE = 10;
const DEV_VOICE_BOUNCE_MAX_COUNT = 100;

type dev_voice_bounce_task = {
    keep_running: boolean;
};

export default class VoiceLog extends BotComponent {
    private readonly event_history = new SelfClearingMap<string, voice_log_event[]>(JOIN_HISTORY_TTL);
    private voice_log_page_button!: BotButton<[string, number, number, string]>;
    private voice_log_delete_button!: BotButton<[string]>;
    private readonly dev_voice_bounce_tasks = new SelfClearingMap<string, dev_voice_bounce_task>(WEEK);
    private dev_voice_bounce_stop_button!: BotButton<[string, string]>;

    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("log", EarlyReplyMode.none)
                        .set_description("Show recent voice events (join/leave) for a voice channel")
                        .add_channel_option({
                            title: "channel",
                            description: "Voice channel (defaults to your current voice channel)",
                            required: false,
                            channel_types: [Discord.ChannelType.GuildVoice, Discord.ChannelType.GuildStageVoice],
                        })
                        .add_number_option({
                            title: "n",
                            description: `Number of most recent events to show (1-${JOIN_HISTORY_MAX_N_OUTPUT})`,
                            required: false,
                        })
                        .set_handler(this.handle_log.bind(this)),
                ),
        );

        if (this.wheatley.devmode_enabled) {
            commands.add(
                new TextBasedCommandBuilder("dev-voice-bounce", EarlyReplyMode.ephemeral)
                    .set_category("Hidden")
                    .set_description("Dev helper: move a member between two voice channels repeatedly")
                    .set_permissions(Discord.PermissionFlagsBits.MoveMembers)
                    .add_channel_option({
                        title: "first",
                        description: "First voice channel",
                        required: true,
                        channel_types: [Discord.ChannelType.GuildVoice, Discord.ChannelType.GuildStageVoice],
                    })
                    .add_channel_option({
                        title: "second",
                        description: "Second voice channel",
                        required: true,
                        channel_types: [Discord.ChannelType.GuildVoice, Discord.ChannelType.GuildStageVoice],
                    })
                    .add_number_option({
                        title: "count",
                        description: `Number of round trips to run (1-${DEV_VOICE_BOUNCE_MAX_COUNT})`,
                        required: true,
                    })
                    .add_user_option({
                        title: "user",
                        description: "Member to move (defaults to yourself)",
                        required: false,
                    })
                    .set_handler(this.handle_dev_voice_bounce.bind(this)),
            );
        }

        this.voice_log_page_button = commands.add(
            new ButtonInteractionBuilder("voice_log_page")
                // channel_id: string, n: number, page: number, issuer_id: string
                .add_string_metadata()
                .add_number_metadata()
                .add_number_metadata()
                .add_user_id_metadata()
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .set_handler(this.handle_log_page.bind(this)),
        );

        this.voice_log_delete_button = commands.add(
            new ButtonInteractionBuilder("voice_log_delete")
                // issuer_id: string
                .add_user_id_metadata()
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .set_handler(this.handle_delete_log.bind(this)),
        );

        this.dev_voice_bounce_stop_button = commands.add(
            new ButtonInteractionBuilder("dev_voice_bounce_stop")
                .add_string_metadata()
                .add_user_id_metadata()
                .set_permissions(Discord.PermissionFlagsBits.MoveMembers)
                .set_handler(this.handle_dev_voice_bounce_stop.bind(this)),
        );
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (new_state.guild.id !== this.wheatley.guild.id) {
            return;
        }
        const member = new_state.member ?? old_state.member;
        if (!member || member.user.bot) {
            return;
        }

        // Ignore no-ops
        if (new_state.channelId === old_state.channelId) {
            return;
        }

        const now = Date.now();
        const cutoff = now - JOIN_HISTORY_WINDOW;

        const record = (channel_id: string, kind: voice_log_event_kind, other_channel_id: string | null) => {
            const key = `${new_state.guild.id}:${channel_id}`;
            const prev = this.event_history.get(key) ?? [];
            const next = prev.filter(e => e.at_ms >= cutoff);
            next.push({
                kind,
                guild_id: new_state.guild.id,
                channel_id,
                user_id: member.id,
                at_ms: now,
                other_channel_id,
                display_name: member.displayName,
                username: member.user.username,
            });
            if (next.length > JOIN_HISTORY_MAX_ENTRIES_PER_CHANNEL) {
                next.splice(0, next.length - JOIN_HISTORY_MAX_ENTRIES_PER_CHANNEL);
            }
            this.event_history.set(key, next);
        };

        // Join
        if (old_state.channelId == null && new_state.channelId != null) {
            record(new_state.channelId, "join", null);
            return;
        }

        // Leave
        if (old_state.channelId != null && new_state.channelId == null) {
            record(old_state.channelId, "leave", null);
            return;
        }

        // Move: record leave in old channel and join in new channel
        if (old_state.channelId != null && new_state.channelId != null) {
            record(old_state.channelId, "leave", new_state.channelId);
            record(new_state.channelId, "join", old_state.channelId);
        }
    }

    private get_recent_events(target_channel: Discord.VoiceBasedChannel, effective_n: number): voice_log_event[] {
        const key = `${this.wheatley.guild.id}:${target_channel.id}`;
        const events = this.event_history.get(key) ?? [];
        const cutoff = Date.now() - JOIN_HISTORY_WINDOW;
        const recent = events.filter(e => e.at_ms >= cutoff);
        // Display newest events first so the log reads top-to-bottom from newest to oldest.
        return recent.slice(-effective_n).reverse();
    }

    private build_log_message(
        target_channel: Discord.VoiceBasedChannel,
        effective_n: number,
        page: number,
        issuer_id: string,
    ): Discord.BaseMessageOptions {
        const newest_first = this.get_recent_events(target_channel, effective_n);
        const delete_button = this.voice_log_delete_button
            .create_button(issuer_id)
            .setLabel("Delete")
            .setEmoji("🗑️")
            .setStyle(Discord.ButtonStyle.Danger);

        if (newest_first.length === 0) {
            return {
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(`No voice history recorded for **${target_channel.name}**.`),
                ],
                components: [
                    new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                        delete_button,
                    ),
                ],
                allowedMentions: { parse: [] },
            };
        }

        const entries = newest_first.map(e => {
            const name = e.display_name || e.username || e.user_id;
            const move =
                e.other_channel_id == null
                    ? ""
                    : e.kind === "join"
                      ? ` • from <#${e.other_channel_id}>`
                      : ` • to <#${e.other_channel_id}>`;
            const kind = e.kind === "join" ? "🟩 **JOIN**" : "🟥 **LEAVE**";
            const when = `${discord_timestamp(e.at_ms, "f")} (${discord_timestamp(e.at_ms, "T")})`;

            // Two-line layout for easier scanning.
            // Note: `allowedMentions: { parse: [] }` keeps the mention clickable without pinging.
            return [`${kind} — ${when}`, `**${name}** (\`${e.username}\`) • <@${e.user_id}>${move}`].join("\n");
        });

        const pages = Math.ceil(entries.length / JOIN_HISTORY_PAGE_SIZE);
        const clamped_page = Math.min(Math.max(page, 0), pages - 1);
        const page_entries = entries.slice(
            clamped_page * JOIN_HISTORY_PAGE_SIZE,
            clamped_page * JOIN_HISTORY_PAGE_SIZE + JOIN_HISTORY_PAGE_SIZE,
        );
        const separator = "\n━━━━━━━━━━━━━━━━━━━━\n";

        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle(
                pages > 1
                    ? `Voice log for ${target_channel.name} (page ${clamped_page + 1} of ${pages})`
                    : `Voice log for ${target_channel.name}`,
            )
            .setDescription(page_entries.join(separator))
            .setFooter({
                text: `${entries.length} event${entries.length === 1 ? "" : "s"} shown (max ${effective_n})`,
            });

        const page_buttons: Discord.ButtonBuilder[] = [];
        if (pages > 1 && clamped_page > 1) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(target_channel.id, effective_n, 0, issuer_id)
                    .setLabel("Start")
                    .setStyle(Discord.ButtonStyle.Secondary),
            );
        }
        if (pages > 1 && clamped_page > 0) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(target_channel.id, effective_n, clamped_page - 1, issuer_id)
                    .setLabel("Previous")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (pages > 1 && clamped_page < pages - 1) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(target_channel.id, effective_n, clamped_page + 1, issuer_id)
                    .setLabel("Next")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }

        const buttons = [...page_buttons, delete_button];

        return {
            embeds: [embed],
            components:
                buttons.length > 0
                    ? [
                          new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                              ...buttons,
                          ),
                      ]
                    : undefined,
            allowedMentions: { parse: [] },
        };
    }

    private async handle_log(command: TextBasedCommand, channel: Discord.Channel | null, n: number | null) {
        const guild = await command.get_guild();

        let target_channel: Discord.VoiceBasedChannel | null = null;

        if (channel) {
            if (!channel.isVoiceBased()) {
                await command.reply(create_error_reply("Error: `channel` must be a voice channel or stage channel"));
                return;
            }
            target_channel = channel;
        } else {
            const member = await command.get_member(guild);
            target_channel = member.voice.channel;
            if (!target_channel) {
                await command.reply(create_error_reply("Error: you must specify `channel` or be in a voice channel"));
                return;
            }
        }

        const requested_n = n ?? 1;
        if (n !== null) {
            if (!Number.isInteger(n) || n < 1) {
                await command.reply(create_error_reply("Error: if provided, `n` must be at least 1"));
                return;
            }
        }
        const effective_n = Math.min(requested_n, JOIN_HISTORY_MAX_N_OUTPUT);

        await command.reply(this.build_log_message(target_channel, effective_n, 0, command.user.id));
    }

    private async handle_dev_voice_bounce(
        command: TextBasedCommand,
        first: Discord.Channel,
        second: Discord.Channel,
        count: number,
        user: Discord.User | null,
    ) {
        const task_id = command.get_command_invocation_snowflake();
        try {
            if (!this.wheatley.devmode_enabled) {
                await command.replyOrFollowUp(
                    create_error_reply("Error: this command is only available in dev mode"),
                    true,
                );
                return;
            }
            if (!first.isVoiceBased() || !second.isVoiceBased()) {
                await command.replyOrFollowUp(
                    create_error_reply("Error: both channels must be voice channels or stage channels"),
                    true,
                );
                return;
            }
            if (first.id === second.id) {
                await command.replyOrFollowUp(create_error_reply("Error: channels must be different"), true);
                return;
            }
            if (!Number.isInteger(count) || count < 1 || count > DEV_VOICE_BOUNCE_MAX_COUNT) {
                await command.replyOrFollowUp(
                    create_error_reply(`Error: count must be an integer from 1 to ${DEV_VOICE_BOUNCE_MAX_COUNT}`),
                    true,
                );
                return;
            }

            const target_user = user ?? command.user;
            const target_member = await this.wheatley.try_fetch_guild_member(target_user);
            if (!target_member) {
                await command.replyOrFollowUp(create_error_reply("Error: target user is not in the server"), true);
                return;
            }
            if (!target_member.voice.channel) {
                await command.replyOrFollowUp(
                    create_error_reply("Error: target user must already be connected to a voice channel"),
                    true,
                );
                return;
            }

            let completed_round_trips = 0;
            this.dev_voice_bounce_tasks.set(task_id, { keep_running: true });
            await command.replyOrFollowUp(
                this.build_dev_voice_bounce_message(
                    task_id,
                    command.user.id,
                    target_member,
                    first,
                    second,
                    count,
                    completed_round_trips,
                    "Running...",
                    true,
                ),
                true,
            );

            for (let i = 0; i < count; i++) {
                if (!this.dev_voice_bounce_tasks.get(task_id)?.keep_running) {
                    break;
                }
                await target_member.voice.setChannel(first);
                if (!this.dev_voice_bounce_tasks.get(task_id)?.keep_running) {
                    break;
                }
                await target_member.voice.setChannel(second);
                completed_round_trips++;
                const keep_running = this.dev_voice_bounce_tasks.get(task_id)?.keep_running ?? false;
                await command.edit(
                    this.build_dev_voice_bounce_message(
                        task_id,
                        command.user.id,
                        target_member,
                        first,
                        second,
                        count,
                        completed_round_trips,
                        keep_running ? "Running..." : "Stopping...",
                        keep_running,
                    ),
                );
            }

            const stopped_early = !this.dev_voice_bounce_tasks.get(task_id)?.keep_running;
            this.dev_voice_bounce_tasks.remove(task_id);
            await command.edit(
                this.build_dev_voice_bounce_message(
                    task_id,
                    command.user.id,
                    target_member,
                    first,
                    second,
                    count,
                    completed_round_trips,
                    stopped_early ? "Stopped" : "Finished",
                    false,
                ),
            );
        } catch (e) {
            this.dev_voice_bounce_tasks.remove(task_id);
            await command.replyOrFollowUp(create_error_reply(`Error: ${e}`), true);
        }
    }

    private build_dev_voice_bounce_message(
        task_id: string,
        issuer_id: string,
        target_member: Discord.GuildMember,
        first: Discord.VoiceBasedChannel,
        second: Discord.VoiceBasedChannel,
        count: number,
        completed_round_trips: number,
        status: string,
        active: boolean,
    ): Discord.BaseMessageOptions & CommandAbstractionReplyOptions {
        return {
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle("Dev voice bounce")
                    .setDescription(
                        [
                            `Target: <@${target_member.id}>`,
                            `Route: <#${first.id}> -> <#${second.id}>`,
                            `Progress: ${completed_round_trips}/${count} round trip${count === 1 ? "" : "s"}`,
                        ].join("\n"),
                    )
                    .setFooter({ text: status }),
            ],
            components: active
                ? [
                      new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                          this.dev_voice_bounce_stop_button
                              .create_button(task_id, issuer_id)
                              .setLabel("Stop")
                              .setStyle(Discord.ButtonStyle.Danger),
                      ),
                  ]
                : [],
            allowedMentions: { parse: [] },
        };
    }

    private async handle_dev_voice_bounce_stop(
        interaction: Discord.ButtonInteraction,
        task_id: string,
        issuer_id: string,
    ) {
        if (interaction.user.id !== issuer_id) {
            const { embeds } = create_error_reply("Only the command issuer can stop this task.");
            await interaction.reply({
                embeds,
                ephemeral: true,
            });
            return;
        }
        const task = this.dev_voice_bounce_tasks.get(task_id);
        if (!task) {
            const { embeds } = create_error_reply("This task is no longer running.");
            await interaction.reply({
                embeds,
                ephemeral: true,
            });
            return;
        }
        task.keep_running = false;
        await interaction.update({
            components: [
                new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    this.dev_voice_bounce_stop_button
                        .create_button(task_id, issuer_id)
                        .setLabel("Stopping...")
                        .setStyle(Discord.ButtonStyle.Secondary)
                        .setDisabled(true),
                ),
            ],
        });
    }

    private async handle_log_page(
        interaction: Discord.ButtonInteraction,
        channel_id: string,
        n: number,
        page: number,
        issuer_id: string,
    ) {
        try {
            if (interaction.user.id !== issuer_id) {
                const { embeds } = create_error_reply("Only the command issuer can use these controls.");
                await interaction.reply({
                    ephemeral: true,
                    embeds,
                });
                return;
            }

            // Acknowledge quickly to avoid "This interaction failed" on slower API calls.
            await interaction.deferUpdate();

            const channel = await this.wheatley.guild.channels.fetch(channel_id);
            if (!channel || !channel.isVoiceBased()) {
                const { embeds } = create_error_reply("Error: voice channel no longer exists");
                await interaction.followUp({ ephemeral: true, embeds });
                return;
            }

            const effective_n = Math.min(Math.max(1, Math.floor(n)), JOIN_HISTORY_MAX_N_OUTPUT);
            await interaction.message.edit(this.build_log_message(channel, effective_n, page, issuer_id));
        } catch (e) {
            const { embeds } = create_error_reply(`Error: ${e}`);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ ephemeral: true, embeds });
            } else {
                await interaction.reply({ ephemeral: true, embeds });
            }
        }
    }

    private async handle_delete_log(interaction: Discord.ButtonInteraction, issuer_id: string) {
        if (interaction.user.id !== issuer_id) {
            const { embeds } = create_error_reply("Only the command issuer can delete this log.");
            await interaction.reply({
                ephemeral: true,
                embeds,
            });
            return;
        }
        try {
            await interaction.deferUpdate();
            await interaction.message.delete();
        } catch (e) {
            const { embeds } = create_error_reply(`Error: ${e}`);
            // `deferUpdate()` means we must follow-up on failure.
            await interaction.followUp({ ephemeral: true, embeds });
        }
    }
}
