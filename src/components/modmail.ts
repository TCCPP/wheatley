import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { get_url_for } from "../utils/discord.js";
import { critical_error } from "../utils/debugging-and-logging.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors, HOUR, MINUTE } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { SelfClearingMap } from "../utils/containers.js";
import { unwrap } from "../utils/misc.js";

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
    const embed = new Discord.EmbedBuilder().setColor(colors.wheatley).setTitle(title).setDescription(msg);
    return embed;
}

/**
 * Modmail system.
 */
export default class Modmail extends BotComponent {
    // Spam prevention, user is added to the timeout set when clicking the modmail_continue button,
    readonly timeout_set = new Set<string>();
    modmail_id_counter = -1;

    readonly monke_set = new SelfClearingMap<Discord.Snowflake, number>(HOUR, HOUR);

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        const singleton = await this.wheatley.database.get_bot_singleton();
        this.modmail_id_counter = singleton.modmail_id_counter;
    }

    async create_modmail_thread(interaction: Discord.ModalSubmitInteraction | Discord.ButtonInteraction) {
        try {
            try {
                // fetch full member
                assert(interaction.member);
                const member = await this.wheatley.TCCPP.members.fetch(interaction.member.user.id);
                // make the thread
                const id = this.modmail_id_counter++;
                await this.wheatley.database.update_bot_singleton({ modmail_id_counter: this.modmail_id_counter });
                const thread = await this.wheatley.channels.rules.threads.create({
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
                await this.wheatley.channels.mods.send({
                    content: get_url_for(thread),
                    embeds: [notification_embed],
                });
                // add everyone
                await thread.members.add(member.id);
                // Deliberately not awaiting here
                await thread.send({
                    content: `<@&${this.wheatley.roles.moderators.id}>`,
                    allowedMentions: {
                        roles: [this.wheatley.roles.moderators.id],
                    },
                });
            } catch (e) {
                if (interaction instanceof Discord.ModalSubmitInteraction) {
                    assert(interaction.isFromMessage());
                    await interaction.update({
                        content: "Something went wrong internally...",
                        components: [],
                    });
                } else {
                    await interaction.reply({
                        content: "Something went wrong internally...",
                        components: [],
                    });
                }
                throw e; // rethrow
            }
        } catch (e) {
            critical_error(e);
        }
    }

    create_modmail_system_embed_and_components() {
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            new Discord.ButtonBuilder()
                .setCustomId("modmail_monkey")
                .setLabel("I'm a monkey")
                .setStyle(Discord.ButtonStyle.Primary),
            new Discord.ButtonBuilder()
                .setCustomId("modmail_create")
                .setLabel("Start a modmail thread")
                .setStyle(Discord.ButtonStyle.Danger),
            new Discord.ButtonBuilder()
                .setCustomId("modmail_not_monkey")
                .setLabel("I'm not a monkey")
                .setStyle(Discord.ButtonStyle.Secondary),
        );
        return {
            content: "",
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
        };
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots
        if (message.author.bot) {
            return;
        }
        if (message.content == "!wsetupmodmailsystem" && this.wheatley.is_root(message.author)) {
            await message.channel.send(this.create_modmail_system_embed_and_components());
        }
        if (message.content.startsWith("!wupdatemodmailsystem") && this.wheatley.is_root(message.author)) {
            // get argument
            const id = message.content.slice("!wupdatemodmailsystem".length).trim();
            await message.delete();
            const target = await message.channel.messages.fetch(id);
            await target.edit(this.create_modmail_system_embed_and_components());
        }
    }

    async monkey_button_press(interaction: Discord.ButtonInteraction) {
        await interaction.reply({
            content:
                "Hello and welcome to Together C&C++ :wave: Please read before pressing buttons and only " +
                "use the modmail system system when there is an __issue requiring staff attention__.",
            ephemeral: true,
        });
        await this.log_action(interaction.member, "Monkey pressed the button");
        try {
            // can't apply roles to root
            if (!this.wheatley.is_root(interaction.user)) {
                const member = await this.wheatley.TCCPP.members.fetch(interaction.user.id);
                await member.roles.add(this.wheatley.roles.monke);
                this.monke_set.set(interaction.user.id, Date.now());
            }
        } catch (e) {
            critical_error(e);
        }
    }

    async not_monkey_button_press(interaction: Discord.ButtonInteraction) {
        await this.log_action(interaction.member, "Monkey pressed the not monkey button");
        const member = await this.wheatley.TCCPP.members.fetch(interaction.user.id);
        if (member.roles.cache.has(this.wheatley.roles.monke.id)) {
            if (!this.monke_set.has(member.id) || Date.now() - unwrap(this.monke_set.get(member.id)) >= HOUR) {
                await interaction.reply({
                    content: "Congratulations on graduating from your monke status.",
                    ephemeral: true,
                });
                try {
                    // can't apply roles to root
                    if (!this.wheatley.is_root(interaction.user)) {
                        await member.roles.remove(this.wheatley.roles.monke);
                        this.monke_set.remove(member.id);
                    }
                } catch (e) {
                    critical_error(e);
                }
            } else {
                await interaction.reply({
                    content: "You must wait at least an hour to remove your monke status.",
                    ephemeral: true,
                });
            }
        } else {
            await interaction.reply({
                content: "No monke role present. If you'd like to become a monke press the \"I'm a monke\" button.",
                ephemeral: true,
            });
        }
    }

    async modmail_create_button_press(interaction: Discord.ButtonInteraction) {
        if (this.timeout_set.has(interaction.user.id)) {
            await interaction.reply({
                ephemeral: true,
                content: "Please don't spam modmail requests -- This button has a 5 minute cooldown",
            });
            await this.log_action(interaction.member, "Modmail button spammed");
        } else {
            const member = await this.wheatley.TCCPP.members.fetch(interaction.user.id);
            const non_beginner_skill_roles = member.roles.cache.filter(role =>
                Object.values(this.wheatley.skill_roles).some(
                    skill_role => role.id == skill_role.id && skill_role.name != "Beginner",
                ),
            );
            if (non_beginner_skill_roles.size > 0) {
                // fast-path people who can read
                await interaction.deferUpdate();
                await this.create_modmail_thread(interaction);
                await interaction.reply({
                    content:
                        "Your modmail request has been processed. A thread has been created and the staff " +
                        "team have been notified.",
                    components: [],
                });
                await this.log_action(interaction.member, "Modmail button pressed, fast path");
            } else {
                // make sure they can read
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
        }
    }

    async modmail_abort_button_press(interaction: Discord.ButtonInteraction) {
        await interaction.update({
            content: "All good :+1:",
            components: [],
        });
        await this.log_action(interaction.member, "Modmail abort sequence");
    }

    async modmail_continue_button_press(interaction: Discord.ButtonInteraction) {
        this.timeout_set.add(interaction.user.id);
        setTimeout(() => {
            this.timeout_set.delete(interaction.user.id);
        }, RATELIMIT_TIME);
        const modal = new Discord.ModalBuilder().setCustomId("modmail_create_confirm").setTitle("Confirm Modmail");
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

    async modmail_modal_submit(interaction: Discord.ModalSubmitInteraction) {
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

    override async on_interaction_create(interaction: Discord.Interaction) {
        if (interaction.isButton()) {
            if (interaction.customId == "modmail_monkey") {
                return this.monkey_button_press(interaction);
            } else if (interaction.customId == "modmail_not_monkey") {
                return this.not_monkey_button_press(interaction);
            } else if (interaction.customId == "modmail_create") {
                return this.modmail_create_button_press(interaction);
            } else if (interaction.customId == "modmail_create_abort") {
                return this.modmail_abort_button_press(interaction);
            } else if (interaction.customId == "modmail_create_continue") {
                return this.modmail_continue_button_press(interaction);
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId == "modmail_create_confirm") {
                return this.modmail_modal_submit(interaction);
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
            .setColor(colors.wheatley)
            .setTitle(title)
            .setAuthor({
                name: tag,
                iconURL: avatar,
            })
            .setFooter({ text: `ID: ${interaction_member?.user.id}` });
        if (body) {
            embed.setDescription(body);
        }
        await this.wheatley.channels.staff_member_log.send({
            embeds: [embed],
        });
    }
}
