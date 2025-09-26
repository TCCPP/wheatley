import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { KeyedMutexSet, SelfClearingMap } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { ModalInteractionBuilder } from "../command-abstractions/modal.js";
import { ButtonInteractionBuilder } from "../command-abstractions/button.js";

export default class Report extends BotComponent {
    private staff_flag_log!: Discord.TextChannel;
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
    readonly target_map = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);
    readonly mutex = new KeyedMutexSet<string>();

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);

        commands.add(new MessageContextMenuInteractionBuilder("Report").set_handler(this.report.bind(this)));

        commands.add(new ModalInteractionBuilder(this.report_modal, this.modal_handler.bind(this)));

        commands.add(new ButtonInteractionBuilder(this.handling, this.handling_handler.bind(this)));
        commands.add(new ButtonInteractionBuilder(this.resolved, this.resolved_handler.bind(this)));
        commands.add(new ButtonInteractionBuilder(this.invalid, this.invalid_handler.bind(this)));
        commands.add(new ButtonInteractionBuilder(this.nvm, this.nvm_handler.bind(this)));
    }

    async report(interaction: Discord.MessageContextMenuCommandInteraction) {
        if (interaction.guildId != this.wheatley.guild.id) {
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
        M.log("Received report modal submit", id);
        await interaction.reply({
            ephemeral: true,
            content: "Processing...",
        });
        try {
            const reporter =
                interaction.member instanceof Discord.GuildMember
                    ? interaction.member
                    : await this.wheatley.guild.members.fetch(interaction.user.id);
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
                const quote_embeds = await this.utilities.make_quote_embeds([target_message], {
                    message_id_footer: true,
                    user_id_footer: true,
                });
                const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    this.handling,
                    this.resolved,
                    this.invalid,
                );
                await this.staff_flag_log.send({
                    content: `<@&${this.wheatley.roles.moderators.id}>`,
                    embeds: [report_embed, ...quote_embeds.embeds],
                    components: [row],
                    files: quote_embeds.files,
                });
                await interaction.editReply({
                    content: "Thank you for flagging this for moderators",
                });
            } else {
                await interaction.editReply({
                    content:
                        "Something went wrong internally due to the report modal not being submitted fast enough." +
                        ` Please re-submit the report. Here is your message so you don't have to re-type it:\n` +
                        message,
                });
                this.wheatley.critical_error("Slow report thing happened");
            }
        } catch (e) {
            try {
                await interaction.editReply({
                    content: "Internal error, please report to Zelis",
                });
            } catch (e2) {
                this.wheatley.critical_error(e2);
            }
            throw e;
        }
    }

    async locked_interaction(interaction: Discord.ButtonInteraction, callback: (m: Discord.Message) => Promise<void>) {
        await interaction.deferReply({ ephemeral: true });
        const message = interaction.message;
        if (!this.mutex.try_lock(message.id)) {
            await interaction.reply({
                content: `Race condition with button presses`,
                ephemeral: true,
            });
            return;
        }
        try {
            await interaction.editReply({
                content: `Received button press, updating message...`,
            });
            await callback(message);
            await interaction.editReply({
                content: `Done`,
            });
        } finally {
            this.mutex.unlock(message.id);
        }
    }

    async nvm_logic(interaction: Discord.ButtonInteraction, message: Discord.Message) {
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.handling,
            this.resolved,
            this.invalid,
        );
        await message.edit({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            components: [row],
        });
    }

    async handling_handler(interaction: Discord.ButtonInteraction) {
        await this.locked_interaction(interaction, async (message: Discord.Message) => {
            if (message.content.includes("Being handled by")) {
                await this.nvm_logic(interaction, message);
                return;
            }
            const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                new Discord.ButtonBuilder(this.handling.data).setLabel(
                    `Being handled by ${await this.wheatley.get_display_name(interaction.user)}`,
                ),
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
        });
    }

    async resolved_handler(interaction: Discord.ButtonInteraction) {
        await this.locked_interaction(interaction, async (message: Discord.Message) => {
            await message.edit({
                content:
                    `<@&${this.wheatley.roles.moderators.id}> -- ` +
                    `**Marked resolved by ${await this.wheatley.get_display_name(interaction.user)}**`,
                components: [],
            });
            await message.react("✅");
        });
    }

    async invalid_handler(interaction: Discord.ButtonInteraction) {
        await this.locked_interaction(interaction, async (message: Discord.Message) => {
            await message.edit({
                content:
                    `<@&${this.wheatley.roles.moderators.id}> -- ` +
                    `**Marked invalid by ${await this.wheatley.get_display_name(interaction.user)}**`,
                components: [],
            });
            await message.react("⛔");
        });
    }

    async nvm_handler(interaction: Discord.ButtonInteraction) {
        await this.locked_interaction(interaction, async (message: Discord.Message) => {
            await this.nvm_logic(interaction, message);
        });
    }
}
