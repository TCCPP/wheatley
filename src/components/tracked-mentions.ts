import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { format_list } from "../utils/strings.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Staff_notification_button_helper, Staff_notification_buttons } from "../utils/staff-notification-buttons.js";

/**
 * Tracks certain mentions, such as mentions of root, moderators, Wheatley, etc.
 */
export default class TrackedMentions extends BotComponent {
    private flag_log!: Discord.TextChannel;
    tracked_mentions!: Set<string>;
    private buttons!: Staff_notification_buttons;
    private button_helper = new Staff_notification_button_helper();

    override async setup(commands: CommandSetBuilder) {
        this.flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);

        this.buttons = this.button_helper.register_buttons(commands, "tracked-mention", {
            handling: this.handling_handler.bind(this),
            resolved: this.resolved_handler.bind(this),
            invalid: this.invalid_handler.bind(this),
            nvm: this.nvm_handler.bind(this),
        });
    }

    override async on_ready() {
        this.tracked_mentions = new Set([
            "540314034894012428", // admin role on test server
            this.wheatley.roles.root.id,
            this.wheatley.roles.moderators.id,
            "892864085006360626", // red dragon
            "970549026514698284", // wheatley
            "1013953887029444678", // dyno
        ]);
    }

    async check_tracked_mention_and_notify(message: Discord.Message) {
        const mentions = [
            ...new Set(message.mentions.roles.map(v => v.id).filter(id => this.tracked_mentions.has(id))),
        ];
        if (mentions.length > 0) {
            M.log("Spotted tracked mention", message.url, message.author.id, message.author.tag);
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setAuthor({
                    name: `${message.author.username}#${message.author.discriminator}`,
                    iconURL: message.author.displayAvatarURL(),
                })
                .setDescription(
                    `${format_list(mentions.map(m => `<@&${m}>`))} mentioned in` +
                        ` <#${message.channel.id}> by <@${message.author.id}>\n` +
                        `[click here to jump](${message.url})`,
                )
                .setFooter({
                    text: `ID: ${message.author.id}`,
                })
                .setTimestamp();
            const row = this.button_helper.create_standard_action_row(this.buttons);
            await this.flag_log.send({ embeds: [embed], components: [row] });
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
        if (
            message.author.id == this.wheatley.user.id ||
            message.author.bot ||
            message.guildId != this.wheatley.guild.id
        ) {
            return;
        }
        if (message.mentions.roles.size > 0) {
            await this.check_tracked_mention_and_notify(message);
        }
    }

    async nvm_logic(interaction: Discord.ButtonInteraction, message: Discord.Message) {
        await message.edit({
            components: [this.button_helper.create_standard_action_row(this.buttons)],
        });
    }

    async handling_handler(interaction: Discord.ButtonInteraction) {
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
            if (message.embeds[0]?.description?.includes("Being handled by")) {
                await this.nvm_logic(interaction, message);
                return;
            }
            const handler_name = await this.wheatley.get_display_name(interaction.user);
            const row = this.button_helper.create_handling_action_row(this.buttons, handler_name);
            const current_embed = message.embeds[0];
            const updated_embed = Discord.EmbedBuilder.from(current_embed).setDescription(
                `${current_embed.description}\n\n**Being handled by ${handler_name}**`,
            );
            await message.edit({
                embeds: [updated_embed],
                components: [row],
            });
        });
    }

    async resolved_handler(interaction: Discord.ButtonInteraction) {
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
            const current_embed = message.embeds[0];
            const description = current_embed.description?.replace(/\n\n\*\*Being handled by .*?\*\*/, "");
            const updated_embed = Discord.EmbedBuilder.from(current_embed).setDescription(
                `${description}\n\n**Marked resolved by ${await this.wheatley.get_display_name(interaction.user)}**`,
            );
            await message.edit({
                embeds: [updated_embed],
                components: [],
            });
            await message.react("✅");
        });
    }

    async invalid_handler(interaction: Discord.ButtonInteraction) {
        await this.button_helper.locked_interaction(interaction, async (message: Discord.Message) => {
            const current_embed = message.embeds[0];
            const description = current_embed.description?.replace(/\n\n\*\*Being handled by .*?\*\*/, "");
            const updated_embed = Discord.EmbedBuilder.from(current_embed).setDescription(
                `${description}\n\n**Marked invalid by ${await this.wheatley.get_display_name(interaction.user)}**`,
            );
            await message.edit({
                embeds: [updated_embed],
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
