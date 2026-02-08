import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { SelfClearingMap } from "../../../utils/containers.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors, MINUTE } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { channel_map } from "../../../channel-map.js";
import { wheatley_channels } from "../channels.js";
import { MessageContextMenuInteractionBuilder } from "../../../command-abstractions/context-menu.js";
import { ModalInteractionBuilder, BotModal, BotModalSubmitInteraction } from "../../../command-abstractions/modal.js";
import {
    Staff_notification_button_helper,
    Staff_notification_buttons,
} from "../../../utils/staff-notification-buttons.js";

export default class Report extends BotComponent {
    private channels = channel_map(this.wheatley, wheatley_channels.staff_flag_log);
    private report_modal!: BotModal<[string]>;
    private buttons!: Staff_notification_buttons;
    private button_helper = new Staff_notification_button_helper();

    // string -> initial target message from context menu interaction
    readonly target_map = new SelfClearingMap<string, Discord.Message>(10 * MINUTE);

    override async setup(commands: CommandSetBuilder) {
        await this.channels.resolve();

        commands.add(
            new MessageContextMenuInteractionBuilder("🚩 Report to Moderators 🚩").set_handler(this.report.bind(this)),
        );

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

        this.buttons = this.button_helper.register_buttons(commands, "report", {
            handling: this.handling_handler.bind(this),
            resolved: this.resolved_handler.bind(this),
            invalid: this.invalid_handler.bind(this),
            nvm: this.nvm_handler.bind(this),
        });
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

    async modal_handler(interaction: BotModalSubmitInteraction, id: string) {
        M.log("Received report modal submit", id);
        await interaction.reply({
            ephemeral: true,
            content: "Processing...",
        });
        try {
            const message = interaction.get_field_value("report-modal-message").trim();
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
                const quote_embeds = await this.utilities.make_quote_embeds(target_message, {
                    message_id_footer: true,
                    user_id_footer: true,
                });
                const row = this.button_helper.create_standard_action_row(this.buttons);
                await this.channels.staff_flag_log.send({
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

    async nvm_logic(interaction: Discord.ButtonInteraction, message: Discord.Message) {
        await message.edit({
            content: `<@&${this.wheatley.roles.moderators.id}>`,
            components: [this.button_helper.create_standard_action_row(this.buttons)],
        });
    }

    async handling_handler(interaction: Discord.ButtonInteraction) {
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
            if (message.content.includes("Being handled by")) {
                await this.nvm_logic(interaction, message);
                return;
            }
            const handler_name = await this.wheatley.get_display_name(interaction.user);
            const row = this.button_helper.create_handling_action_row(this.buttons, handler_name);
            await message.edit({
                content: `<@&${this.wheatley.roles.moderators.id}> -- ` + `**Being handled by ${handler_name}**`,
                components: [row],
            });
        });
    }

    async resolved_handler(interaction: Discord.ButtonInteraction) {
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
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
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
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
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
            await this.nvm_logic(interaction, message);
        });
    }
}
