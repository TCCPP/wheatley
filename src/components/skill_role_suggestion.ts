import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { critical_error, M, SelfClearingMap, unwrap } from "../utils";
import { colors, MINUTE, TCCPP_ID } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { MessageContextMenuCommandBuilder, ModalHandler, UserContextMenuCommandBuilder } from "../command";
import { make_quote_embeds } from "./quote";

export class SkillRoleSuggestion extends BotComponent {
    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, {member: Discord.GuildMember, role?: string}>(5 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new UserContextMenuCommandBuilder("Suggest Skill Role")
                .set_handler(this.skill_suggestion.bind(this))
        );
    }

    async skill_suggestion(interaction: Discord.UserContextMenuCommandInteraction) {
        if(interaction.guildId != TCCPP_ID) {
            await interaction.reply({
                ephemeral: true,
                content: "Report can only be used in TCCPP"
            });
            return;
        }
        const member = interaction.targetMember instanceof Discord.GuildMember ? interaction.targetMember
            : await this.wheatley.TCCPP.members.fetch(interaction.targetId);
        assert(member);
        M.log("Received skill suggest interaction", interaction.user.tag, interaction.user.id, interaction.targetId);
        this.target_map.set(interaction.user.id, { member });
        await interaction.reply({
            content: `Suggest a skill role for ${member.displayName}`,
            components: [
                new Discord.ActionRowBuilder<Discord.StringSelectMenuBuilder>().addComponents(
                    new Discord.StringSelectMenuBuilder()
                        .setCustomId("skill-role-suggestion-picker")
                        .setOptions([
                            {
                                label: "Intermediate",
                                value: "Intermediate",
                            },
                            {
                                label: "Proficient",
                                value: "Proficient",
                            },
                            {
                                label: "Advanced",
                                value: "Advanced",
                            },
                            {
                                label: "Expert",
                                value: "Expert",
                            }
                        ])
                )
            ],
            ephemeral: true
        });
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if(interaction.isStringSelectMenu() && interaction.customId == "skill-role-suggestion-picker") {
            const modal = new Discord.ModalBuilder()
                .setCustomId("skill-role-suggestion-modal")
                .setTitle("Skill Role Suggestion");
            const { member } = unwrap(this.target_map.get(interaction.user.id));
            this.target_map.get(interaction.user.id)!.role = interaction.values[0];
            const row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>()
                .addComponents(
                    new Discord.TextInputBuilder()
                        .setCustomId("skill-role-suggestion-modal-comments")
                        .setLabel("Comments [optional]")
                        .setPlaceholder(`Why are you suggesting ${interaction.values[0]} for ${member.displayName}?`)
                        .setRequired(false)
                        .setStyle(Discord.TextInputStyle.Paragraph)
                );
            modal.addComponents(row);
            await interaction.showModal(modal);
        } else if(interaction.isModalSubmit() && interaction.customId == "skill-role-suggestion-modal") {
            const suggester = interaction.member instanceof Discord.GuildMember ? interaction.member
                : await this.wheatley.TCCPP.members.fetch(interaction.user.id);
            const { member, role } = unwrap(this.target_map.get(interaction.user.id));
            const suggestion_modal = new Discord.EmbedBuilder()
                .setColor(colors.green)
                .setAuthor({
                    name: suggester.displayName,
                    iconURL: suggester.avatarURL() ?? suggester.user.displayAvatarURL()
                })
                .setFooter({
                    text: `Suggested for ${member.displayName} ${member.user.id} by ${interaction.user.id}`,
                    iconURL: member.avatarURL() ?? member.user.displayAvatarURL()
                });
            const comments = interaction.fields.getTextInputValue("skill-role-suggestion-modal-comments");
            let description = `Skill role suggestion for <@${member.user.id}>: ${role}`;
            if(comments.length > 0) {
                description += `\nComments: ${comments}`;
            }
            suggestion_modal.setDescription(description);
            await this.wheatley.skill_role_suggestion_log.send({
                embeds: [suggestion_modal]
            });
            await interaction.reply({
                content: "Thank you, your suggestion has been received",
                ephemeral: true
            });
        }
    }
}
