import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { KeyedMutexSet, SelfClearingMap } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuInteractionBuilder } from "../command-abstractions/context-menu.js";
import { ModalInteractionBuilder, BotModal } from "../command-abstractions/modal.js";
import { BotButton, ButtonInteractionBuilder } from "../command-abstractions/button.js";

export default class Report extends BotComponent {
    private staff_flag_log!: Discord.TextChannel;
    private report_modal!: BotModal<[string]>;
    private handling_button!: BotButton<[]>;
    private resolved_button!: BotButton<[]>;
    private invalid_button!: BotButton<[]>;
    private nvm_button!: BotButton<[]>;

    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);
    readonly mutex = new KeyedMutexSet<string>();

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);

        commands.add(new MessageContextMenuInteractionBuilder("Report").set_handler(this.report.bind(this)));

        this.report_modal = commands.add(
            new ModalInteractionBuilder("report-modal")
                .set_title("Report Message")
                .add_string_metadata()
                .add_paragraph_field("report-modal-message", "Message", {
                    placeholder: "Optional message / additional info",
                    required: false,
                })
                .set_handler(this.modal_handler.bind(this)),
        );

        this.handling_button = commands.add(
            new ButtonInteractionBuilder("report-handling").set_handler(this.handling_handler.bind(this)),
        );
        this.resolved_button = commands.add(
            new ButtonInteractionBuilder("report-resolved").set_handler(this.resolved_handler.bind(this)),
        );
        this.invalid_button = commands.add(
            new ButtonInteractionBuilder("report-invalid").set_handler(this.invalid_handler.bind(this)),
        );
        this.nvm_button = commands.add(
            new ButtonInteractionBuilder("report-nvm").set_handler(this.nvm_handler.bind(this)),
        );
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

        const modal = this.report_modal.create_modal(interaction.targetMessage.id);
        await interaction.showModal(modal);
    }

    async modal_handler(interaction: Discord.ModalSubmitInteraction, id: string) {
        M.log("Received report modal submit", id);
        await interaction.reply({
            ephemeral: true,
            content: "Processing...",
        });
        try {
            const message = this.report_modal.get_field_value(interaction, "report-modal-message").trim();
            const reporter =
                interaction.member instanceof Discord.GuildMember
                    ? interaction.member
                    : await this.wheatley.guild.members.fetch(interaction.user.id);
            if (this.target_map.has(id)) {
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
                const row = this.create_standard_action_row();
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

    // Helper methods for creating buttons
    private create_handling_button(label?: string) {
        return this.handling_button
            .create_button()
            .setLabel(label ?? "I'm looking into this")
            .setStyle(Discord.ButtonStyle.Secondary);
    }

    private create_resolved_button() {
        return this.resolved_button.create_button().setLabel("Resolved").setStyle(Discord.ButtonStyle.Success);
    }

    private create_invalid_button() {
        return this.invalid_button.create_button().setLabel("Invalid").setStyle(Discord.ButtonStyle.Danger);
    }

    private create_nvm_button() {
        return this.nvm_button
            .create_button()
            .setLabel("I'm no longer looking into this")
            .setStyle(Discord.ButtonStyle.Secondary);
    }

    // Helper method for creating the standard action row
    private create_standard_action_row() {
        return new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.create_handling_button(),
            this.create_resolved_button(),
            this.create_invalid_button(),
        );
    }

    // Helper method for creating the handling action row with custom label and nvm button
    private create_handling_action_row(handler_name: string) {
        return new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.create_handling_button(`Being handled by ${handler_name}`),
            this.create_nvm_button(),
            this.create_resolved_button(),
            this.create_invalid_button(),
        );
    }

    async nvm_logic(interaction: Discord.ButtonInteraction, message: Discord.Message) {
        await message.edit({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            components: [this.create_standard_action_row()],
        });
    }

    async handling_handler(interaction: Discord.ButtonInteraction) {
        await this.locked_interaction(interaction, async (message: Discord.Message) => {
            if (message.content.includes("Being handled by")) {
                await this.nvm_logic(interaction, message);
                return;
            }
            const row = this.create_handling_action_row(await this.wheatley.get_display_name(interaction.user));
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
