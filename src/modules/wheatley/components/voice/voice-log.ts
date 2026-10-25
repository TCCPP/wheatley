import * as Discord from "discord.js";

import { colors, DAY, MONTH, WEEK } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { BotButton, ButtonInteractionBuilder } from "../../../../command-abstractions/button.js";
import { discord_timestamp } from "../../../../utils/discord.js";
import { create_error_reply } from "../../../../wheatley.js";
import type { Filter } from "mongodb";

type voice_log_event_kind = "join" | "leave" | "move";
type target_type = "user" | "channel";

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
const JOIN_HISTORY_MAX_N_OUTPUT = 200;
const JOIN_HISTORY_PAGE_SIZE = 10;

const DEFAULT_HISTORY_AMOUNT = 10;

const VOICE_EVENT_HISTORY_RETAIN_TIME = MONTH;

export default class VoiceLog extends BotComponent {
    private voice_log_page_button!: BotButton<[target_type, string, number, number, string]>;
    private voice_log_delete_button!: BotButton<[string]>;

    private readonly database = this.wheatley.database.create_proxy<{ voice_log_events: voice_log_event }>();

    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        // Prune the voice history frequently
        await this.prune_voice_history();
        setInterval(() => void this.prune_voice_history().catch(this.wheatley.critical_error.bind(this.wheatley)), DAY);

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
                        .add_user_option({
                            title: "user",
                            description: "User to get logs from",
                            required: false,
                        })
                        .add_number_option({
                            title: "amount",
                            description: `Number of most recent events to show (1-${JOIN_HISTORY_MAX_N_OUTPUT})`,
                            required: false,
                        })
                        .set_handler(this.handle_log.bind(this)),
                ),
        );

        this.voice_log_page_button = commands.add(
            new ButtonInteractionBuilder("voice_log_page")
                // type: target_type, user_id: string, amount: number, page: number, issuer_id: string
                .add_string_metadata()
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

        const record = async (channel_id: string, kind: voice_log_event_kind, other_channel_id: string | null) => {
            const entry: voice_log_event = {
                kind,
                guild_id: new_state.guild.id,
                channel_id,
                user_id: member.id,
                at_ms: Date.now(),
                other_channel_id,
                display_name: member.displayName,
                username: member.user.username,
            };

            await this.database.voice_log_events.insertOne(entry);
        };

        // Join
        if (old_state.channelId == null && new_state.channelId != null) {
            await record(new_state.channelId, "join", null);
            return;
        }

        // Leave
        if (old_state.channelId != null && new_state.channelId == null) {
            await record(old_state.channelId, "leave", null);
            return;
        }

        // Move: record leave in old channel and join in new channel
        if (old_state.channelId != null && new_state.channelId != null) {
            await record(old_state.channelId, "move", new_state.channelId);
        }
    }

    private async get_recent_events(
        target: Discord.User | Discord.VoiceBasedChannel,
        amount: number = DEFAULT_HISTORY_AMOUNT,
    ): Promise<Array<voice_log_event>> {
        const cutoff = Date.now() - JOIN_HISTORY_WINDOW;

        const filter: Filter<voice_log_event> = {
            guild_id: this.wheatley.guild.id,
            at_ms: {
                $gte: cutoff,
            },
        };

        if (target instanceof Discord.User) {
            filter.user_id = target.id;
        } else {
            filter.$or = [
                {
                    channel_id: target.id,
                },
                {
                    kind: "move",
                    other_channel_id: target.id,
                },
            ];
        }

        return await this.database.voice_log_events.find(filter).sort({ at_ms: -1 }).limit(amount).toArray();
    }

    private async build_log_message(
        target: Discord.User | Discord.VoiceBasedChannel,
        effective_amount: number,
        page: number,
        issuer_id: string,
    ): Promise<Discord.BaseMessageOptions> {
        const newest_first = await this.get_recent_events(target, effective_amount);

        const delete_button = this.voice_log_delete_button
            .create_button(issuer_id)
            .setLabel("Delete")
            .setEmoji("🗑️")
            .setStyle(Discord.ButtonStyle.Danger);

        const target_name = target instanceof Discord.User ? target.username : target.name;

        if (newest_first.length === 0) {
            return {
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(`No voice history recorded for **${target_name}**.`),
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

            const kind = e.kind == "move" ? "➡️ **MOVE**" : e.kind === "join" ? "🟩 **JOIN**" : "🟥 **LEAVE**";
            const when = `${discord_timestamp(e.at_ms, "f")} (${discord_timestamp(e.at_ms, "T")})`;

            const location =
                e.kind == "move"
                    ? ` • <#${e.channel_id}> to <#${e.other_channel_id}>`
                    : target instanceof Discord.User
                      ? e.kind === "join"
                          ? ` • joined <#${e.channel_id}>`
                          : ` • left <#${e.channel_id}>`
                      : ""; // <- forever lonely :^) (pleasing tenary)

            // Two-line layout for easier scanning.
            // Note: `allowedMentions: { parse: [] }` keeps the mention clickable without pinging.
            return [`${kind} — ${when}`, `**${name}** (\`${e.username}\`) • <@${e.user_id}>${location}`].join("\n");
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
                    ? `Voice log for ${target_name} (page ${clamped_page + 1} of ${pages})`
                    : `Voice log for ${target_name}`,
            )
            .setDescription(page_entries.join(separator))
            .setFooter({
                text: `${entries.length} event${entries.length === 1 ? "" : "s"} shown (max ${effective_amount})`,
            });

        const page_buttons: Discord.ButtonBuilder[] = [];
        if (pages > 1 && clamped_page > 1) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(
                        target instanceof Discord.User ? "user" : "channel",
                        target.id,
                        effective_amount,
                        0,
                        issuer_id,
                    )
                    .setLabel("Start")
                    .setStyle(Discord.ButtonStyle.Secondary),
            );
        }
        if (pages > 1 && clamped_page > 0) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(
                        target instanceof Discord.User ? "user" : "channel",
                        target.id,
                        effective_amount,
                        clamped_page - 1,
                        issuer_id,
                    )
                    .setLabel("Previous")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (pages > 1 && clamped_page < pages - 1) {
            page_buttons.push(
                this.voice_log_page_button
                    .create_button(
                        target instanceof Discord.User ? "user" : "channel",
                        target.id,
                        effective_amount,
                        clamped_page + 1,
                        issuer_id,
                    )
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

    private async handle_log(
        command: TextBasedCommand,
        channel: Discord.Channel | null,
        user: Discord.User | null,
        amount: number | null,
    ) {
        const guild = await command.get_guild();

        let target_channel: Discord.VoiceBasedChannel | null = null;

        if (channel && user) {
            await command.reply(create_error_reply("Error: you must specify either `channel` or `user` but not both"));
            return;
        }

        if (channel) {
            if (!channel.isVoiceBased()) {
                await command.reply(create_error_reply("Error: `channel` must be a voice channel or stage channel"));
                return;
            }
            target_channel = channel;
        }

        if (!target_channel && !user) {
            const member = await command.get_member(guild);
            target_channel = member.voice.channel;
            if (!target_channel) {
                await command.reply(create_error_reply("Error: you must specify `channel` or be in a voice channel"));
                return;
            }
        }

        const requested_amount = amount ?? DEFAULT_HISTORY_AMOUNT;
        if (amount !== null) {
            if (!Number.isInteger(amount) || amount < 1) {
                await command.reply(create_error_reply("Error: if provided, `amount` must be at least 1"));
                return;
            }
        }

        const effective_amount = Math.min(requested_amount, JOIN_HISTORY_MAX_N_OUTPUT);
        await command.reply(
            await this.build_log_message((target_channel ?? user)!, effective_amount, 0, command.user.id),
        );
    }

    private async handle_log_page(
        interaction: Discord.ButtonInteraction,
        target_type: string,
        target_id: string,
        amount: number,
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

            let target: Discord.User | Discord.VoiceBasedChannel;
            if (target_type === "user") {
                target = await interaction.client.users.fetch(target_id);
            } else if (target_type == "channel") {
                const channel = await this.wheatley.guild.channels.fetch(target_id).catch(_ => {});
                if (!channel?.isVoiceBased()) {
                    const { embeds } = create_error_reply("Error: voice channel no longer exists");
                    await interaction.followUp({ ephemeral: true, embeds });
                    return;
                }

                target = channel;
            } else {
                const { embeds } = create_error_reply(`Unknown target type: ${target_type}`);
                await interaction.followUp({
                    ephemeral: true,
                    embeds,
                });

                return;
            }

            const effective_amount = Math.min(Math.max(1, Math.floor(amount)), JOIN_HISTORY_MAX_N_OUTPUT);
            await interaction.message.edit(await this.build_log_message(target, effective_amount, page, issuer_id));
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

    private async prune_voice_history(): Promise<void> {
        await this.database.voice_log_events.deleteMany({
            at_ms: {
                $lt: Date.now() - VOICE_EVENT_HISTORY_RETAIN_TIME,
            },
        });
    }
}
