import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, SelfClearingMap, departialize, unwrap } from "../utils.js";
import { colors, MINUTE, skill_role_suggestion_log_id, TCCPP_ID } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuCommandBuilder, UserContextMenuCommandBuilder } from "../command.js";

export class SkillRoleSuggestion extends BotComponent {
    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, {member: Discord.GuildMember, role?: string}>(5 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new UserContextMenuCommandBuilder("Suggest Skill Role User")
                .set_handler(this.skill_suggestion.bind(this))
        );
        this.add_command(
            new MessageContextMenuCommandBuilder("Suggest Skill Role Message")
                .set_handler(this.skill_suggestion.bind(this))
        );
    }

    override destroy() {
        super.destroy();
        this.target_map.destroy();
    }

    async skill_suggestion(
        interaction: Discord.UserContextMenuCommandInteraction | Discord.MessageContextMenuCommandInteraction
    ) {
        if(interaction.guildId != TCCPP_ID) {
            await interaction.reply({
                ephemeral: true,
                content: "Report can only be used in TCCPP"
            });
            return;
        }
        const target_member = interaction instanceof Discord.UserContextMenuCommandInteraction
            ? interaction.targetMember : interaction.targetMessage.member;
        const member = target_member instanceof Discord.GuildMember ? target_member
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
                    name: member.displayName,
                    iconURL: member.avatarURL() ?? member.user.displayAvatarURL()
                })
                .setFooter({
                    text: `Suggested by ${suggester.displayName} ${suggester.user.id} for ${member.user.id}`,
                    iconURL: suggester.avatarURL() ?? suggester.user.displayAvatarURL()
                });
            const comments = interaction.fields.getTextInputValue("skill-role-suggestion-modal-comments");
            let description = `Skill role suggestion for <@${member.user.id}> by <@${suggester.user.id}>: ${role}`;
            if(comments.length > 0) {
                description += `\nComments: ${comments}`;
            }
            suggestion_modal.setDescription(description);
            const suggestion = await this.wheatley.skill_role_suggestion_log.send({
                embeds: [suggestion_modal]
            });
            await interaction.reply({
                content: "Thank you, your suggestion has been received",
                ephemeral: true
            });
            await suggestion.react("👍");
            await suggestion.react("👎");
            await suggestion.react("🧵");
        }
    }

    override async on_reaction_add(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser
    ) {
        if(reaction.message.channel.id != skill_role_suggestion_log_id || user.id == this.wheatley.id) {
            return;
        }
        if(reaction.partial) {
            reaction = await reaction.fetch();
        }
        if(reaction.emoji.name == "🧵") {
            const message = await departialize(reaction.message);
            const name = await (async () => {
                if(message.author.id == this.wheatley.id) {
                    return message.embeds[0].author?.name;
                } else {
                    return null;
                }
            })();
            await message.startThread({
                name: name ? `- ${name}` : "Discussion"
            });
            await unwrap(message.reactions.cache.get("🧵")).remove();
        }
    }
}
