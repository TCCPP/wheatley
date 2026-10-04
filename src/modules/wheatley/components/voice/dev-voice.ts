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
import { create_error_reply } from "../../../../wheatley.js";

const DEV_VOICE_BOUNCE_MAX_COUNT = 100;

type dev_voice_bounce_task = {
    keep_running: boolean;
};

type dev_voice_bounce_context = {
    task_id: string;
    issuer_id: string;
    target_member: Discord.GuildMember;
    first: Discord.VoiceBasedChannel;
    second: Discord.VoiceBasedChannel;
    count: number;
};

export default class VoiceDev extends BotComponent {
    private readonly dev_voice_bounce_tasks = new SelfClearingMap<string, dev_voice_bounce_task>(WEEK);
    private dev_voice_bounce_stop_button!: BotButton<[string, string]>;

    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        if (!this.wheatley.devmode_enabled) {
            return;
        }

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

        this.dev_voice_bounce_stop_button = commands.add(
            new ButtonInteractionBuilder("dev_voice_bounce_stop")
                .add_string_metadata()
                .add_user_id_metadata()
                .set_permissions(Discord.PermissionFlagsBits.MoveMembers)
                .set_handler(this.handle_dev_voice_bounce_stop.bind(this)),
        );
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
            const bounce_context: dev_voice_bounce_context = {
                task_id,
                issuer_id: command.user.id,
                target_member,
                first,
                second,
                count,
            };
            this.dev_voice_bounce_tasks.set(task_id, { keep_running: true });
            await command.replyOrFollowUp(
                this.build_dev_voice_bounce_message(bounce_context, completed_round_trips, "Running...", true),
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
                        bounce_context,
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
                    bounce_context,
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
        context: dev_voice_bounce_context,
        completed_round_trips: number,
        status: string,
        active: boolean,
    ): Discord.BaseMessageOptions & CommandAbstractionReplyOptions {
        const { task_id, issuer_id, target_member, first, second, count } = context;

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
}
