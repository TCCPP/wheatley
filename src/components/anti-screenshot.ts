import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { delay, M } from "../utils.js";
import { colors, has_skill_roles_other_than_beginner, is_forum_help_thread } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

const DISMISS_TIME = 30 * 1000;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(msg);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

function are_images({ contentType }: { contentType: string | null }) {
    assert(contentType);
    return contentType.startsWith("image/");
}

function are_text({ contentType }: { contentType: string | null }) {
    assert(contentType);
    return contentType.startsWith("text/");
}

function message_might_have_code(message: string) {
    return message.includes("```") || message.match(/[{};]/g);
}

/**
 * Informs users that they shouldn't post screenshots of their code in threads.
 */
export default class AntiScreenshot extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot) return;
        if (message.id == message.channel.id) {
            assert(message.channel instanceof Discord.ThreadChannel);
            if (is_forum_help_thread(message.channel)) {
                // forum created and starter message now exists
                // anti-screenshot logic
                await this.anti_screenshot(message, message.channel);
            }
        }
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isButton()) {
            if (
                interaction.customId == "anti_screenshot_acknowledge" &&
                interaction.user.id == (interaction.channel as Discord.ThreadChannel).ownerId
            ) {
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
                        .setColor(colors.color)
                        .setTitle((interaction.channel as Discord.ThreadChannel).name)
                        .setURL(interaction.channel!.url)
                        .setAuthor({
                            name: interaction.user.tag,
                            iconURL: interaction.user.avatarURL()!,
                        });
                    await this.wheatley.staff_message_log.send({
                        content: "Anti-screenshot message dismissed",
                        embeds: [log_embed],
                    });
                }
            }
        }
    }

    async anti_screenshot(starter_message: Discord.Message, thread: Discord.ThreadChannel) {
        await delay(1000);
        assert(starter_message);
        assert(starter_message.member);
        // trust people with skill roles
        if (has_skill_roles_other_than_beginner(starter_message.member)) {
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
                new Discord.ButtonBuilder()
                    .setCustomId("anti_screenshot_acknowledge")
                    .setLabel("Acknowledge/Dismiss")
                    .setStyle(Discord.ButtonStyle.Danger),
            );
            await thread.send({
                content: `<@${thread.ownerId}>`,
                embeds: [
                    create_embed(
                        "Screenshots!",
                        colors.red,
                        "Your message appears to contain screenshots" +
                            " but no code. Please send code and error messages in text instead of screenshots if" +
                            " applicable!",
                    ),
                ],
                components: [row],
            });
            // Log to the message log
            const log_embed = new Discord.EmbedBuilder()
                .setColor(colors.color)
                .setTitle(thread.name)
                .setURL(starter_message.url)
                .setAuthor({
                    name: starter_message.author.tag,
                    iconURL: starter_message.author.avatarURL()!,
                })
                .setDescription(starter_message.content || "<empty>");
            await this.wheatley.staff_message_log.send({
                content: "Anti-screenshot message sent",
                embeds: [log_embed],
                files: starter_message.attachments.map(a => a),
            });
        }
    }
}
