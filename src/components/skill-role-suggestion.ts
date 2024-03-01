import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { unwrap } from "../utils/misc.js";
import { departialize } from "../utils/discord.js";
import { SelfClearingMap } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { skill_roles_order, skill_roles_order_id, Wheatley } from "../wheatley.js";
import {
    UserContextMenuInteractionBuilder,
    MessageContextMenuInteractionBuilder,
} from "../command-abstractions/context-menu.js";
import { build_description, capitalize } from "../utils/strings.js";

// schema
export type skill_suggestion_entry = {
    user_id: string;
    channel_id: string;
};

/**
 * Adds commands for users to suggest skill roles for other members.
 */
export default class SkillRoleSuggestion extends BotComponent {
    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, { member: Discord.GuildMember; role?: string }>(15 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new UserContextMenuInteractionBuilder("Suggest Skill Role User").set_handler(
                this.skill_suggestion.bind(this),
            ),
        );
        this.add_command(
            new MessageContextMenuInteractionBuilder("Suggest Skill Role Message").set_handler(
                this.skill_suggestion.bind(this),
            ),
        );
    }

    async skill_suggestion(
        interaction: Discord.UserContextMenuCommandInteraction | Discord.MessageContextMenuCommandInteraction,
    ) {
        if (interaction.guildId != this.wheatley.TCCPP.id) {
            await interaction.reply({
                ephemeral: true,
                content: "Report can only be used in TCCPP",
            });
            return;
        }
        const target_member =
            interaction instanceof Discord.UserContextMenuCommandInteraction
                ? interaction.targetMember
                : interaction.targetMessage.member;
        const member =
            target_member instanceof Discord.GuildMember
                ? target_member
                : await this.wheatley.TCCPP.members.fetch(interaction.targetId);
        const suggester =
            interaction.member instanceof Discord.GuildMember
                ? interaction.member
                : await this.wheatley.TCCPP.members.fetch(interaction.user.id);
        assert(member);
        M.log("Received skill suggest interaction", interaction.user.tag, interaction.user.id, interaction.targetId);
        this.target_map.set(interaction.user.id, { member });
        const target_skill_index = Math.max(
            ...member.roles.cache
                .filter(r => Object.values(this.wheatley.skill_roles).some(skill_role => r.id == skill_role.id))
                .map(role => skill_roles_order_id.indexOf(role.id)),
        );
        const suggestor_skill_index = Math.max(
            ...suggester.roles.cache
                .filter(r => Object.values(this.wheatley.skill_roles).some(skill_role => r.id == skill_role.id))
                .map(role => skill_roles_order_id.indexOf(role.id)),
        );
        const skill_roles_available = skill_roles_order.slice(
            target_skill_index + 1, // can't suggest anything <= the target's skill
            Math.max(suggestor_skill_index, 0) + 2, // can't suggest anything >= suggestor's skill + 1
        );
        if (skill_roles_available.length == 0) {
            await interaction.reply({
                content: `Unable to suggest skill roles for this user, they are either the max role or exceed yours`,
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: `Suggest a skill role for ${member.displayName}`,
                components: [
                    new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
                        new Discord.StringSelectMenuBuilder().setCustomId("skill-role-suggestion-picker").setOptions(
                            skill_roles_available.map(role => ({
                                label: capitalize(role),
                                value: capitalize(role),
                            })),
                        ),
                    ),
                ],
                ephemeral: true,
            });
        }
    }

    async get_thread(member: Discord.GuildMember) {
        const entry = await this.wheatley.database.skill_role_suggestions.findOne({ user_id: member.user.id });
        if (entry) {
            const thread = await this.wheatley.channels.skill_role_suggestions.threads.fetch(entry.channel_id);
            if (thread) {
                return thread;
            }
        }
        await this.wheatley.database.lock();
        try {
            const thread = await this.wheatley.channels.skill_role_suggestions.threads.create({
                name: member.displayName,
                autoArchiveDuration: Discord.ThreadAutoArchiveDuration.ThreeDays,
                message: {
                    content: `Skill role suggestions for ${member.displayName}`,
                },
            });
            const res = await this.wheatley.database.skill_role_suggestions.insertOne({
                user_id: member.user.id,
                channel_id: thread.id,
            });
            assert(res.acknowledged);
            return thread;
        } finally {
            this.wheatley.database.unlock();
        }
    }

    async launch_modal(interaction: Discord.StringSelectMenuInteraction) {
        const modal = new Discord.ModalBuilder()
            .setCustomId("skill-role-suggestion-modal")
            .setTitle("Skill Role Suggestion");
        const { member } = unwrap(this.target_map.get(interaction.user.id));
        this.target_map.get(interaction.user.id)!.role = interaction.values[0];
        const row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
            new Discord.TextInputBuilder()
                .setCustomId("skill-role-suggestion-modal-comments")
                .setLabel("Comments [optional]")
                .setPlaceholder(`Why are you suggesting ${interaction.values[0]} for ${member.displayName}?`)
                .setRequired(false)
                .setStyle(Discord.TextInputStyle.Paragraph),
        );
        modal.addComponents(row);
        await interaction.showModal(modal);
    }

    async handle_modal_submit(interaction: Discord.ModalSubmitInteraction) {
        const suggester =
            interaction.member instanceof Discord.GuildMember
                ? interaction.member
                : await this.wheatley.TCCPP.members.fetch(interaction.user.id);
        const { member, role } = unwrap(this.target_map.get(interaction.user.id));
        const suggestion_modal = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setAuthor({
                name: member.displayName,
                iconURL: member.avatarURL() ?? member.user.displayAvatarURL(),
            })
            .setFooter({
                text: `For: ${member.user.id}`,
            });
        const comments = interaction.fields.getTextInputValue("skill-role-suggestion-modal-comments");
        const description = build_description(
            `Skill role suggestion for <@${member.user.id}>: **${role}**`,
            `Suggested by: <@${suggester.user.id}>`,
            comments.length > 0 ? `Comments: ${comments}` : null,
        );
        suggestion_modal.setDescription(description);
        const suggestion = await (
            await this.get_thread(member)
        ).send({
            embeds: [suggestion_modal],
        });
        await interaction.reply({
            content: "Thank you, your suggestion has been received",
            ephemeral: true,
        });
        await suggestion.react("👍");
        await suggestion.react("👎");
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isStringSelectMenu() && interaction.customId == "skill-role-suggestion-picker") {
            return this.launch_modal(interaction);
        } else if (interaction.isModalSubmit() && interaction.customId == "skill-role-suggestion-modal") {
            return this.handle_modal_submit(interaction);
        }
    }
}
