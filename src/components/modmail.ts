import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { critical_error, get_url_for, M } from "../utils.js";
import { colors, is_authorized_admin, is_root, MINUTE, moderators_role_id } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

/*
 * Flow:
 * Monkey -> Monkey
 * Start Modmail:
 *     Cancel -> All good
 *     Continue:
 *         Modal prompting for codeword, "foobar" backwards
 *             Correct codeword -> Modmail
 *             Incorrect -> Are you sure you want to make a modmail thread?
 *
 */

const RATELIMIT_TIME = 5 * MINUTE;

function create_embed(title: string, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(colors.color).setTitle(title).setDescription(msg);
    return embed;
}

/**
 * Modmail system.
 */
export default class Modmail extends BotComponent {
    // Spam prevention, user is added to the timeout set when clicking the modmail_continue button,
    readonly timeout_set = new Set<string>();
    modmail_id_counter = -1;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        const singleton = await this.wheatley.database.get_bot_singleton();
        this.modmail_id_counter = singleton.modmail_id_counter;
    }

    async create_modmail_thread(interaction: Discord.ModalSubmitInteraction) {
        try {
            assert(interaction.isFromMessage());
            try {
                // fetch full member
                assert(interaction.member);
                const member = await this.wheatley.TCCPP.members.fetch(interaction.member.user.id);
                // make the thread
                const id = this.modmail_id_counter++;
                await this.wheatley.database.update_bot_singleton({ modmail_id_counter: this.modmail_id_counter });
                const thread = await this.wheatley.rules_channel.threads.create({
                    type: Discord.ChannelType.PrivateThread,
                    invitable: false,
                    name: `Modmail #${id}`,
                    autoArchiveDuration: Discord.ThreadAutoArchiveDuration.OneWeek,
                });
                // initial message
                await thread.send({
                    embeds: [
                        create_embed(
                            "Modmail",
                            "Hello, thank you for reaching out. The staff team can view this thread" +
                                " and will respond as soon as possible. When the issue is resolved, use `!archive` to" +
                                " archive the thread.",
                        ),
                    ],
                });
                // send notification in mods channel
                const notification_embed = create_embed("Modmail Thread Created", `<#${thread.id}>`);
                notification_embed.setAuthor({
                    name: member.user.tag,
                    iconURL: member.displayAvatarURL(),
                });
                await this.wheatley.mods_channel.send({
                    content: get_url_for(thread),
                    embeds: [notification_embed],
                });
                // add everyone
                await thread.members.add(member.id);
                // Deliberately not awaiting here
                await thread.send({
                    content: `<@&${moderators_role_id}>`,
                    allowedMentions: {
                        roles: [moderators_role_id],
                    },
                });
            } catch (e) {
                await interaction.update({
                    content: "Something went wrong internally...",
                    components: [],
                });
                throw e; // rethrow
            }
        } catch (e) {
            critical_error(e);
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots
        if (message.author.bot) {
            return;
        }
        if (message.content == "!wsetupmodmailsystem" && is_authorized_admin(message.member!)) {
            const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                new Discord.ButtonBuilder()
                    .setCustomId("modmail_monkey")
                    .setLabel("I'm a monkey")
                    .setStyle(Discord.ButtonStyle.Primary),
                new Discord.ButtonBuilder()
                    .setCustomId("modmail_create")
                    .setLabel("Start a modmail thread")
                    .setStyle(Discord.ButtonStyle.Danger),
            );
            await message.channel.send({
                embeds: [
                    create_embed(
                        "Modmail",
                        "If you have a **moderation** or **administration** related issue you " +
                            "can reach out to the staff team by pressing the modmail thread button below.\n\n" +
                            "Because, in our experience, a surprising number of users also can't read, there is also " +
                            "a monkey button.",
                    ),
                ],
                components: [row],
            });
        }
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isButton()) {
            if (interaction.customId == "modmail_monkey") {
                await interaction.reply({
                    content:
                        "Hello and welcome to Together C&C++ :wave: Please read before pressing buttons and only " +
                        "use the modmail system system when there is an __issue requiring staff attention__.",
                    ephemeral: true,
                });
                await this.log_action(interaction.member, "Monkey pressed the button");
                try {
                    assert(interaction.member);
                    if (!is_root(interaction.member.user)) {
                        // permissions, the .setNickname will fail
                        const member = await this.wheatley.TCCPP.members.fetch(interaction.member.user.id);
                        await member.roles.add(this.wheatley.monke_role);
                        await member.setNickname("Monke");
                    }
                } catch (e) {
                    critical_error(e);
                }
            } else if (interaction.customId == "modmail_create") {
                if (this.timeout_set.has(interaction.user.id)) {
                    await interaction.reply({
                        ephemeral: true,
                        content: "Please don't spam modmail requests -- This button has a 5 minute cooldown",
                    });
                    await this.log_action(interaction.member, "Modmail button spammed");
                } else {
                    const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                        new Discord.ButtonBuilder()
                            .setCustomId("modmail_create_abort")
                            .setLabel("Cancel")
                            .setStyle(Discord.ButtonStyle.Primary),
                        new Discord.ButtonBuilder()
                            .setCustomId("modmail_create_continue")
                            .setLabel("Continue")
                            .setStyle(Discord.ButtonStyle.Danger),
                    );
                    await interaction.reply({
                        ephemeral: true,
                        content:
                            "Please only submit a modmail request if you have a server issue requiring staff " +
                            'attention! If you really intend to submit a modmail request enter the word "foobar" ' +
                            "backwards when prompted",
                        components: [row],
                    });
                    await this.log_action(interaction.member, "Modmail button pressed");
                }
            } else if (interaction.customId == "modmail_create_abort") {
                await interaction.update({
                    content: "All good :+1:",
                    components: [],
                });
                await this.log_action(interaction.member, "Modmail abort sequence");
            } else if (interaction.customId == "modmail_create_continue") {
                this.timeout_set.add(interaction.user.id);
                setTimeout(() => {
                    this.timeout_set.delete(interaction.user.id);
                }, RATELIMIT_TIME);
                const modal = new Discord.ModalBuilder()
                    .setCustomId("modmail_create_confirm")
                    .setTitle("Confirm Modmail");
                const row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
                    new Discord.TextInputBuilder()
                        .setCustomId("modmail_create_confirm_codeword")
                        .setLabel("Codeword")
                        .setPlaceholder("You'll know if you read the last message")
                        .setStyle(Discord.TextInputStyle.Short),
                );
                modal.addComponents(row);
                await interaction.showModal(modal);
                await this.log_action(interaction.member, "Modmail continue");
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId == "modmail_create_confirm") {
                const codeword = interaction.fields.getTextInputValue("modmail_create_confirm_codeword");
                if (codeword.toLowerCase().replace(/\s/g, "").includes("raboof")) {
                    await interaction.deferUpdate();
                    await this.create_modmail_thread(interaction);
                    await interaction.editReply({
                        content:
                            "Your modmail request has been processed. A thread has been created and the staff " +
                            "team have been notified.",
                        components: [],
                    });
                    await this.log_action(interaction.member, "Modmail submit");
                } else {
                    assert(interaction.isFromMessage());
                    await interaction.update({
                        content: "Codeword was incorrect, do you really mean to start a modmail thread?",
                        components: [],
                    });
                    await this.log_action(interaction.member, "Modmail incorrect codeword");
                }
            }
        }
    }

    async log_action(
        interaction_member: Discord.GuildMember | Discord.APIInteractionGuildMember | null,
        title: string,
        body?: string,
    ) {
        const [tag, avatar] = await (async () => {
            if (interaction_member) {
                const member = await this.wheatley.TCCPP.members.fetch(interaction_member.user.id);
                return [member.user.tag, member.displayAvatarURL()];
            } else {
                return ["NULL", ""];
            }
        })();
        M.log("Modmail log:", interaction_member?.user.id, tag, title);
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.color)
            .setTitle(title)
            .setAuthor({
                name: tag,
                iconURL: avatar,
            })
            .setFooter({ text: `ID: ${interaction_member?.user.id}` });
        if (body) {
            embed.setDescription(body);
        }
        await this.wheatley.staff_member_log_channel.send({
            embeds: [embed],
        });
    }
}
