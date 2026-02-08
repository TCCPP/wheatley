import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { descending, unwrap } from "../../../utils/misc.js";
import { departialize, get_tag } from "../../../utils/discord.js";
import { SelfClearingMap } from "../../../utils/containers.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors, DAY, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import SkillRoles, { SkillLevel, skill_level } from "./skill-roles.js";
import {
    UserContextMenuInteractionBuilder,
    MessageContextMenuInteractionBuilder,
} from "../../../command-abstractions/context-menu.js";
import { ModalInteractionBuilder, BotModal, BotModalSubmitInteraction } from "../../../command-abstractions/modal.js";
import { build_description, capitalize } from "../../../utils/strings.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { channel_map } from "../../../channel-map.js";
import { tccpp_channels } from "../channels.js";

type skill_suggestion_entry = {
    user_id: string;
    suggested_by: string;
    time: number;
    level: skill_level;
};

type skill_suggestion_thread_entry = {
    user_id: string;
    channel_id: string;
    thread_opened: number;
    thread_closed: number | null;
};

type interaction_context = { member: Discord.GuildMember; level?: skill_level; context?: Discord.Message };

export default class SkillRoleSuggestion extends BotComponent {
    private skill_roles!: SkillRoles;

    readonly target_map = new SelfClearingMap<string, interaction_context>(15 * MINUTE);

    private database = this.wheatley.database.create_proxy<{
        skill_role_suggestions: skill_suggestion_entry;
        skill_role_threads: skill_suggestion_thread_entry;
    }>();

    private channels = channel_map(this.wheatley, tccpp_channels.skill_role_suggestions);
    private suggestion_modal!: BotModal<[]>;

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.skill_role_threads, { channel_id: 1 }, { unique: true });
        await ensure_index(this.wheatley, this.database.skill_role_threads, { user_id: 1 });

        await this.channels.resolve();
        this.skill_roles = unwrap(this.wheatley.components.get("SkillRoles")) as SkillRoles;

        commands.add(
            new UserContextMenuInteractionBuilder("Suggest Skill Role User").set_handler(
                this.skill_suggestion.bind(this),
            ),
        );
        commands.add(
            new MessageContextMenuInteractionBuilder("Suggest Skill Role Message").set_handler(
                this.skill_suggestion.bind(this),
            ),
        );

        commands.add(
            new TextBasedCommandBuilder("close-skill-suggestion-thread", EarlyReplyMode.ephemeral)
                .set_category("Admin utilities")
                .set_description("Closes a skill role suggestions thread")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.close_thread.bind(this)),
        );

        this.suggestion_modal = commands.add(
            new ModalInteractionBuilder("skill-role-suggestion-modal")
                .set_title("Skill Role Suggestion")
                .add_paragraph_field("skill-role-suggestion-modal-comments", "Comments [optional]", {
                    placeholder: "Why are you suggesting this role?",
                    required: false,
                })
                .set_handler(this.handle_modal_submit.bind(this)),
        );
    }

    async skill_suggestion(
        interaction: Discord.UserContextMenuCommandInteraction | Discord.MessageContextMenuCommandInteraction,
    ) {
        if (interaction.guildId != this.wheatley.guild.id) {
            await interaction.reply({
                ephemeral: true,
                content: "Report can only be used in TCCPP",
            });
            return;
        }
        await interaction.reply({
            ephemeral: true,
            content: "Processing...",
        });
        const target_member =
            interaction instanceof Discord.UserContextMenuCommandInteraction
                ? interaction.targetMember
                : interaction.targetMessage.member;
        const member =
            target_member instanceof Discord.GuildMember
                ? target_member
                : await this.wheatley.guild.members.fetch(interaction.targetId);
        const suggester =
            interaction.member instanceof Discord.GuildMember
                ? interaction.member
                : await this.wheatley.guild.members.fetch(interaction.user.id);
        assert(member);
        M.log("Received skill suggest interaction", interaction.user.tag, interaction.user.id, interaction.targetId);
        const context =
            interaction instanceof Discord.MessageContextMenuCommandInteraction ? interaction.targetMessage : undefined;
        this.target_map.set(interaction.user.id, { member, context });
        const target_skill_index = this.skill_roles.find_highest_skill_level(member);
        const suggestor_skill_index = this.skill_roles.find_highest_skill_level(suggester);
        const skill_levels_available = Object.keys(SkillLevel).slice(
            target_skill_index + 1, // can't suggest anything <= the target's skill
            Math.max(suggestor_skill_index, 0) + 2, // can't suggest anything >= suggestor's skill + 1
        );
        if (skill_levels_available.length == 0) {
            await interaction.editReply({
                content: `Unable to suggest skill roles for this user, they are either the max role or exceed yours`,
            });
        } else {
            await interaction.editReply({
                content: `Suggest a skill role for ${member.displayName}`,
                components: [
                    new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
                        new Discord.StringSelectMenuBuilder().setCustomId("skill-role-suggestion-picker").setOptions(
                            skill_levels_available.map(level => ({
                                label: capitalize(level),
                                value: level,
                            })),
                        ),
                    ),
                ],
            });
        }
    }

    async make_thread_status(
        member: Discord.GuildMember,
        thread_start_time: number,
    ): Promise<{ tags: string[]; content: string }> {
        const suggestions = await this.database.skill_role_suggestions
            .find({ user_id: member.id, time: { $gte: thread_start_time } })
            .toArray();
        const counts: Record<skill_level, number> = {
            beginner: 0,
            intermediate: 0,
            proficient: 0,
            advanced: 0,
            expert: 0,
        };
        for (const suggestion of suggestions) {
            assert(suggestion.level in counts);
            counts[suggestion.level]++;
        }
        const sorted_filtered_counts = Object.entries(counts)
            .toSorted((a, b) => descending(a, b, v => v[1]))
            .filter(v => v[1] !== 0);
        const suggested_levels = sorted_filtered_counts.map(([k, _]) => k);
        const open_tag = get_tag(this.channels.skill_role_suggestions, "Open").id;
        const role_tags = suggested_levels.map(
            role => get_tag(this.channels.skill_role_suggestions, capitalize(role)).id,
        );
        return {
            tags: [open_tag, ...role_tags],
            content: build_description(
                `<@${member.id}> ${member.displayName}`,
                `Suggested roles: ${sorted_filtered_counts
                    .map(([level, count]) => `${count}x<@&${this.skill_roles.roles[level as skill_level].id}>`)
                    .join(", ")}`,
            ),
        };
    }

    async update_or_make_thread(
        member: Discord.GuildMember,
        suggestion_time: number,
    ): Promise<Discord.ForumThreadChannel> {
        await this.wheatley.database.lock();
        try {
            const entry = await this.database.skill_role_threads.findOne({
                user_id: member.user.id,
                thread_closed: null,
            });
            if (entry) {
                const thread = await this.channels.skill_role_suggestions.threads.fetch(entry.channel_id);
                if (thread) {
                    if (thread.archived) {
                        await thread.setArchived(false);
                    }
                    const start = unwrap(await thread.fetchStarterMessage());
                    const { content, tags } = await this.make_thread_status(member, entry.thread_opened);
                    await start.edit({ content });
                    await thread.setAppliedTags(tags);
                    return thread;
                }
            }
            const { content, tags } = await this.make_thread_status(member, suggestion_time);
            const thread = await this.channels.skill_role_suggestions.threads.create({
                name: member.displayName,
                autoArchiveDuration: Discord.ThreadAutoArchiveDuration.OneWeek,
                message: {
                    content,
                    allowedMentions: { parse: [] },
                },
            });
            await thread.send({
                poll: {
                    question: {
                        text: "Skill level?",
                    },
                    answers: [
                        { text: "intermediate", emoji: "🐸" },
                        { text: "proficient", emoji: "🩵" },
                        { text: "advanced", emoji: "💙" },
                        { text: "expert", emoji: "💜" },
                    ],
                    allowMultiselect: false,
                    duration: 24 * 30, // 30 days
                },
            });
            const thread_entry: skill_suggestion_thread_entry = {
                user_id: member.user.id,
                channel_id: thread.id,
                thread_opened: suggestion_time,
                thread_closed: null,
            };
            const res = await this.database.skill_role_threads.insertOne(thread_entry);
            assert(res.acknowledged);
            await thread.setAppliedTags(tags);
            return thread;
        } finally {
            this.wheatley.database.unlock();
        }
    }

    async handle_suggestion(
        member: Discord.GuildMember,
        suggester: Discord.GuildMember,
        level: skill_level,
        comments: string,
        context: Discord.Message<boolean> | undefined,
    ) {
        assert(level in this.skill_roles.roles);
        const role = this.skill_roles.roles[level];
        const suggestion_time = Date.now();
        const res = await this.database.skill_role_suggestions.insertOne({
            user_id: member.user.id,
            suggested_by: suggester.user.id,
            time: suggestion_time,
            level,
        });
        assert(res.acknowledged);
        const thread = await this.update_or_make_thread(member, suggestion_time);
        await thread.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(role.color)
                    .setAuthor({
                        name: member.displayName,
                        iconURL: member.avatarURL() ?? member.user.displayAvatarURL(),
                    })
                    .setDescription(
                        build_description(
                            `Skill role suggestion for <@${member.user.id}>: **${role.name}**`,
                            `Suggested by: <@${suggester.user.id}>`,
                            `Context: ${context ? `[link](${context.url})` : "None (user context menu)"}`,
                            comments.length > 0 ? `Comments: ${comments}` : null,
                        ),
                    )
                    .setFooter({
                        text: `For: ${member.user.id}`,
                    }),
            ],
            allowedMentions: { parse: [] },
        });
    }

    async launch_modal(interaction: Discord.StringSelectMenuInteraction) {
        unwrap(this.target_map.get(interaction.user.id)).level = interaction.values[0] as skill_level;
        const modal = this.suggestion_modal.create_modal();
        await interaction.showModal(modal);
    }

    async handle_modal_submit(interaction: BotModalSubmitInteraction) {
        await interaction.reply({
            content: "Working...",
            ephemeral: true,
        });
        const suggester =
            interaction.member instanceof Discord.GuildMember
                ? interaction.member
                : await this.wheatley.guild.members.fetch(interaction.user.id);
        const { member, level, context } = unwrap(this.target_map.get(interaction.user.id));
        const comments = interaction.get_field_value("skill-role-suggestion-modal-comments");
        // TODO: Why does role need to be unwrapped?
        await this.handle_suggestion(member, suggester, unwrap(level), comments, context);
        await interaction.editReply({
            content: "Thank you, your suggestion has been received",
        });
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isStringSelectMenu() && interaction.customId == "skill-role-suggestion-picker") {
            if (interaction.guildId !== this.wheatley.guild.id) {
                await interaction.reply("Can only be used in the guild");
            }
            return this.launch_modal(interaction);
        }
    }

    async close_thread(command: TextBasedCommand) {
        const channel = await command.get_channel();
        if (!channel.isThread() || !(channel.parent instanceof Discord.ForumChannel)) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription("Command must be used on a skill role suggestion thread."),
                ],
            });
            return;
        }
        const thread_entries = await this.database.skill_role_threads
            .aggregate([
                {
                    $match: {
                        channel_id: channel.id,
                    },
                },
                {
                    $sort: {
                        thread_opened: -1,
                    },
                },
                {
                    $limit: 1,
                },
            ])
            .toArray();
        if (thread_entries.length === 0) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setDescription("Thread not found in the skill role thread database."),
                ],
            });
            return;
        }
        const thread_entry = thread_entries[0];
        if (!thread_entry.thread_closed) {
            const res = await this.database.skill_role_threads.updateOne(
                {
                    channel_id: channel.id,
                },
                {
                    $set: {
                        thread_closed: Date.now(),
                    },
                },
            );
            assert(res.matchedCount == 1);
        }
        const open_tag = get_tag(channel.parent, "Open").id;
        const closed_tag = get_tag(channel.parent, "Closed").id;
        await channel.setAppliedTags([closed_tag].concat(channel.appliedTags.filter(tag => tag !== open_tag)));
        await command.reply({
            embeds: [new Discord.EmbedBuilder().setColor(colors.wheatley).setDescription("Closing now, thanks all.")],
        });
        await channel.setAutoArchiveDuration(Discord.ThreadAutoArchiveDuration.OneDay);
        await channel.setArchived(true);
    }
}
