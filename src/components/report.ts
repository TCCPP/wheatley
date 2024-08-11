import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { SelfClearingMap } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { ModalInteractionBuilder } from "../command-abstractions/modal.js";
import { ButtonInteractionBuilder } from "../command-abstractions/button.js";

export default class Report extends BotComponent {
    private readonly report_modal = new Discord.ModalBuilder()
        .setCustomId("report-modal")
        .setTitle("Report Message")
        .addComponents(
            new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
                new Discord.TextInputBuilder()
                    .setCustomId("report-modal-message")
                    .setLabel("Message")
                    .setPlaceholder("Optional message / additional info")
                    .setStyle(Discord.TextInputStyle.Paragraph)
                    .setRequired(false),
            ),
        );
    private readonly handling = new Discord.ButtonBuilder()
        .setCustomId("report-handling")
        .setLabel("I'm looking into this")
        .setStyle(Discord.ButtonStyle.Secondary);
    private readonly resolved = new Discord.ButtonBuilder()
        .setCustomId("report-resolved")
        .setLabel("Resolved")
        .setStyle(Discord.ButtonStyle.Success);
    private readonly invalid = new Discord.ButtonBuilder()
        .setCustomId("report-invalid")
        .setLabel("Invalid")
        .setStyle(Discord.ButtonStyle.Danger);
    private readonly nvm = new Discord.ButtonBuilder()
        .setCustomId("report-nvm")
        .setLabel("I'm no longer looking into this")
        .setStyle(Discord.ButtonStyle.Secondary);

    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, Discord.Message>(5 * MINUTE);

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(new MessageContextMenuInteractionBuilder("Report").set_handler(this.report.bind(this)));

        this.add_command(new ModalInteractionBuilder(this.report_modal, this.modal_handler.bind(this)));

        this.add_command(new ButtonInteractionBuilder(this.handling, this.handling_handler.bind(this)));
        this.add_command(new ButtonInteractionBuilder(this.resolved, this.resolved_handler.bind(this)));
        this.add_command(new ButtonInteractionBuilder(this.invalid, this.invalid_handler.bind(this)));
        this.add_command(new ButtonInteractionBuilder(this.nvm, this.nvm_handler.bind(this)));
    }

    async report(interaction: Discord.MessageContextMenuCommandInteraction) {
        if (interaction.guildId != this.wheatley.TCCPP.id) {
            await interaction.reply({
                ephemeral: true,
                content: "Report can only be used in TCCPP",
            });
            return;
        }
        M.log("Received report command", interaction.user.tag, interaction.user.id, interaction.targetId);
        this.target_map.set(interaction.targetMessage.id, interaction.targetMessage);
        const modal = new Discord.ModalBuilder()
            .setCustomId(`report-modal--${interaction.targetMessage.id}`)
            .setTitle("Report Message");
        modal.addComponents(
            new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
                new Discord.TextInputBuilder()
                    .setCustomId("report-modal-message")
                    .setLabel("Message")
                    .setPlaceholder("Optional message / additional info")
                    .setStyle(Discord.TextInputStyle.Paragraph)
                    .setRequired(false),
            ),
        );
        await interaction.showModal(modal);
    }

    async modal_handler(interaction: Discord.ModalSubmitInteraction, id: string, message: string) {
        const reporter =
            interaction.member instanceof Discord.GuildMember
                ? interaction.member
                : await this.wheatley.TCCPP.members.fetch(interaction.user.id);
        M.log("Received report modal submit", id);
        if (this.target_map.has(id)) {
            message = message.trim();
            const target_message = this.target_map.get(id)!;
            const report_embed = new Discord.EmbedBuilder()
                .setColor(colors.alert_color)
                .setAuthor({
                    name: reporter.displayName,
                    iconURL: reporter.avatarURL() ?? interaction.user.displayAvatarURL(),
                })
                .setTitle("Report Received")
                .setFooter({
                    text: `ID: ${interaction.user.id}`,
                });
            if (message.length > 0) {
                report_embed.setDescription(`Message: ${message}`);
            }
            const quote_embeds = await this.wheatley.make_quote_embeds([target_message], {
                message_id_footer: true,
                user_id_footer: true,
            });
            const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                this.handling,
                this.resolved,
                this.invalid,
            );
            await this.wheatley.channels.staff_flag_log.send({
                content: `<@&${this.wheatley.roles.moderators.id}>`,
                embeds: [report_embed, ...quote_embeds.embeds],
                components: [row],
                files: quote_embeds.files,
            });
            await interaction.reply({
                ephemeral: true,
                content: "Thank you for flagging this for moderators",
            });
        } else {
            await interaction.reply({
                ephemeral: true,
                content:
                    "Something went wrong internally due to the report modal not being submitted after a while." +
                    ` Please re-submit the report. Here is your message so you don't have to re-type it:\n${message}`,
            });
            this.wheatley.critical_error("Slow report thing happened");
        }
    }

    async handling_handler(interaction: Discord.ButtonInteraction) {
        const message = interaction.message;
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.nvm,
            this.resolved,
            this.invalid,
        );
        await message.edit({
            content:
                `<@&${this.wheatley.roles.moderators.id}> -- ` +
                `**Being handled by ${await this.wheatley.get_display_name(interaction.user)}**`,
            components: [row],
        });
        await interaction.deferUpdate();
    }

    async resolved_handler(interaction: Discord.ButtonInteraction) {
        const message = interaction.message;
        await message.edit({
            content:
                `<@&${this.wheatley.roles.moderators.id}> -- ` +
                `**Marked resolved by ${await this.wheatley.get_display_name(interaction.user)}**`,
            components: [],
        });
        await message.react("✅");
        await interaction.deferUpdate();
    }

    async invalid_handler(interaction: Discord.ButtonInteraction) {
        const message = interaction.message;
        await message.edit({
            content:
                `<@&${this.wheatley.roles.moderators.id}> -- ` +
                `**Marked resolved by ${await this.wheatley.get_display_name(interaction.user)}**`,
            components: [],
        });
        await message.react("⛔");
        await interaction.deferUpdate();
    }

    async nvm_handler(interaction: Discord.ButtonInteraction) {
        const message = interaction.message;
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.handling,
            this.resolved,
            this.invalid,
        );
        await message.edit({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            components: [row],
        });
        await interaction.deferUpdate();
    }
}
