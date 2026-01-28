import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { delay } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { ButtonInteractionBuilder, BotButton } from "../../../command-abstractions/button.js";

const DISMISS_TIME = 30 * 1000;

function are_images(attachment: Discord.Attachment) {
    assert(attachment.contentType, JSON.stringify(attachment));
    return attachment.contentType.startsWith("image/");
}

function are_text({ contentType }: { contentType: string | null }) {
    assert(contentType);
    return contentType.startsWith("text/");
}

function message_might_have_code(message: string) {
    return message.includes("```") || message.match(/[{};]/g);
}

export default class AntiScreenshot extends BotComponent {
    private staff_message_log!: Discord.TextChannel;

    private acknowledge_button!: BotButton<[]>;

    override async setup(commands: CommandSetBuilder) {
        this.staff_message_log = await this.utilities.get_channel(this.wheatley.channels.staff_message_log.id);

        this.acknowledge_button = commands.add(
            new ButtonInteractionBuilder("anti_screenshot_acknowledge").set_handler(
                this.acknowledge_handler.bind(this),
            ),
        );
    }

    override async on_message_create(message: Discord.Message) {
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (message.author.bot) {
            return;
        }
        if (message.id == message.channel.id) {
            assert(message.channel instanceof Discord.ThreadChannel);
            if (this.wheatley.is_forum_help_thread(message.channel)) {
                // forum created and starter message now exists
                // anti-screenshot logic
                await this.anti_screenshot(message, message.channel);
            }
        }
    }

    async acknowledge_handler(interaction: Discord.ButtonInteraction) {
        if (interaction.user.id !== (interaction.channel as Discord.ThreadChannel).ownerId) {
            await interaction.reply({
                ephemeral: true,
                content: "Only the thread owner can acknowledge this message.",
            });
            return;
        }

        const time = interaction.createdTimestamp - interaction.message.createdTimestamp;
        if (time < DISMISS_TIME) {
            M.debug(
                "anti_screenshot_acknowledge received too quick",
                interaction.channel?.url,
                interaction.user.id,
                interaction.user.tag,
            );
            await interaction.reply({
                ephemeral: true,
                content: "Please read before dismissing. You will be allowed to dismiss in a few seconds.",
            });
        } else {
            M.debug(
                "anti_screenshot_acknowledge received",
                interaction.channel?.url,
                interaction.user.id,
                interaction.user.tag,
            );
            await interaction.message.delete();
            // Log to the message log
            const log_embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setTitle((interaction.channel as Discord.ThreadChannel).name)
                .setURL(interaction.channel!.url)
                .setAuthor({
                    name: interaction.user.tag,
                    iconURL: interaction.user.avatarURL()!,
                });
            await this.staff_message_log.send({
                content: "Anti-screenshot message dismissed",
                embeds: [log_embed],
            });
        }
    }

    async anti_screenshot(starter_message: Discord.Message, thread: Discord.ThreadChannel) {
        await delay(1000);
        assert(starter_message);
        // trust established members
        if (await this.wheatley.is_established_member(starter_message.author)) {
            return;
        }
        // check if it has images and no code
        if (
            starter_message.attachments.some(are_images) &&
            !starter_message.attachments.some(are_text) &&
            !message_might_have_code(starter_message.content)
        ) {
            M.log("anti-screenshot firing", thread.url);
            const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                this.acknowledge_button
                    .create_button()
                    .setLabel("Acknowledge/Dismiss")
                    .setStyle(Discord.ButtonStyle.Danger),
            );
            await thread.send({
                content: `<@${thread.ownerId}>`,
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.red)
                        .setTitle("Screenshots!")
                        .setDescription(
                            "Your message appears to contain screenshots but no code. " +
                                "Please send code and error messages in text instead of screenshots if applicable!",
                        ),
                ],
                components: [row],
            });
            // Log to the message log
            const log_embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setTitle(thread.name)
                .setURL(starter_message.url)
                .setAuthor({
                    name: starter_message.author.tag,
                    iconURL: starter_message.author.avatarURL()!,
                })
                .setDescription(starter_message.content || "<empty>");
            await this.staff_message_log.send({
                content: "Anti-screenshot message sent",
                embeds: [log_embed],
                files: starter_message.attachments.map(a => a),
            });
        }
    }
}
