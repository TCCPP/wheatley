import * as Discord from "discord.js";

import { colors, WEEK } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
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

export default class VoiceLog extends BotComponent {
    private readonly event_history = new SelfClearingMap<string, voice_log_event[]>(JOIN_HISTORY_TTL);
    private voice_log_page_button!: BotButton<[string, number, number, string]>;
    private voice_log_delete_button!: BotButton<[string]>;

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
            const profile = `[\`${e.user_id}\`](discord://-/users/${e.user_id})`;
            const move =
                e.other_channel_id == null
                    ? ""
                    : e.kind === "join"
                      ? ` • from <#${e.other_channel_id}>`
                      : ` • to <#${e.other_channel_id}>`;
            const kind = e.kind === "join" ? "🟩 **JOIN**" : "🟥 **LEAVE**";
            const when = `${discord_timestamp(e.at_ms, "f")} (${discord_timestamp(e.at_ms, "T")})`;

            // Two-line layout for easier scanning.
            // Note: `allowedMentions: { parse: [] }` prevents pings if we ever add mentions later.
            return [`${kind} — ${when}`, `**${name}** (\`${e.username}\`) • ${profile}${move}`].join("\n");
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
        if (pages > 1 && clamped_page > 0) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(target_channel.id, effective_n, clamped_page - 1, issuer_id)
                    .setLabel("🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (pages > 1 && clamped_page < pages - 1) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(target_channel.id, effective_n, clamped_page + 1, issuer_id)
                    .setLabel("🡆")
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

        const requested_n = n ?? JOIN_HISTORY_MAX_N_OUTPUT;
        if (n !== null) {
            if (!Number.isInteger(n) || n < 1) {
                await command.reply(create_error_reply("Error: if provided, `n` must be at least 1"));
                return;
            }
        }
        const effective_n = Math.min(requested_n, JOIN_HISTORY_MAX_N_OUTPUT);

        await command.reply(this.build_log_message(target_channel, effective_n, 0, command.user.id));
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
