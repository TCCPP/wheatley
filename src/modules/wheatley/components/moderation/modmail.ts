import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { make_url } from "../../../../utils/discord.js";
import { M } from "../../../../utils/debugging-and-logging.js";
import { colors, HOUR, MINUTE } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { Wheatley } from "../../../../wheatley.js";
import { moderation_state, monke_button_press_entry } from "./schemata.js";
import { SelfClearingMap } from "../../../../utils/containers.js";
import { unwrap } from "../../../../utils/misc.js";
import { set_timeout } from "../../../../utils/node.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { MessageContextMenuInteractionBuilder } from "../../../../command-abstractions/context-menu.js";
import { ButtonInteractionBuilder, BotButton } from "../../../../command-abstractions/button.js";
import {
    ModalInteractionBuilder,
    BotModal,
    BotModalSubmitInteraction,
} from "../../../../command-abstractions/modal.js";

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

export default class Modmail extends BotComponent {
    // Spam prevention, user is added to the timeout set when clicking the modmail_continue button,
    readonly timeout_set = new Set<string>();

    readonly monke_set = new SelfClearingMap<Discord.Snowflake, number>(HOUR, HOUR);

    private monkey_button!: BotButton<[]>;
    private not_monkey_button!: BotButton<[]>;
    private create_button!: BotButton<[]>;
    private abort_button!: BotButton<[]>;
    private continue_button!: BotButton<[]>;

    private confirm_modal!: BotModal<[]>;

    private database = this.wheatley.database.create_proxy<{
        component_state: moderation_state;
        monke_button_presses: monke_button_press_entry;
    }>();
    private rules!: Discord.TextChannel;
    private mods!: Discord.TextChannel;
    private staff_member_log!: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.rules = await this.utilities.get_channel(this.wheatley.channels.rules.id);
        this.mods = await this.utilities.get_channel(this.wheatley.channels.mods.id);
        this.staff_member_log = await this.utilities.get_channel(this.wheatley.channels.staff_member_log.id);
        commands.add(
            new TextBasedCommandBuilder("wsetupmodmailsystem", EarlyReplyMode.none)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Create modmail message here")
                .set_slash(false)
                .set_handler(this.modmail_setup.bind(this)),
        );
        commands.add(
            new TextBasedCommandBuilder("wupdatemodmailsystem", EarlyReplyMode.none)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_description("Update modmail message")
                .set_slash(false)
                .add_string_option({
                    title: "message_id",
                    description: "Message ID",
                    required: true,
                })
                .set_handler(this.modmail_update.bind(this)),
        );

        this.monkey_button = commands.add(
            new ButtonInteractionBuilder("modmail_monkey").set_handler(this.monkey_button_press.bind(this)),
        );
        this.not_monkey_button = commands.add(
            new ButtonInteractionBuilder("modmail_not_monkey").set_handler(this.not_monkey_button_press.bind(this)),
        );
        this.create_button = commands.add(
            new ButtonInteractionBuilder("modmail_create").set_handler(this.modmail_create_button_press.bind(this)),
        );
        this.abort_button = commands.add(
            new ButtonInteractionBuilder("modmail_create_abort").set_handler(
                this.modmail_abort_button_press.bind(this),
            ),
        );
        this.continue_button = commands.add(
            new ButtonInteractionBuilder("modmail_create_continue").set_handler(
                this.modmail_continue_button_press.bind(this),
            ),
        );

        this.confirm_modal = commands.add(
            new ModalInteractionBuilder("modmail_create_confirm")
                .set_title("Confirm Modmail")
                .add_short_text_field("modmail_create_confirm_codeword", "Codeword", {
                    placeholder: "You'll know if you read the last message",
                    required: true,
                })
                .set_handler(this.modmail_modal_submit.bind(this)),
        );
    }

    private async modmail_setup(command: TextBasedCommand) {
        assert(command.channel && !(command.channel instanceof Discord.PartialGroupDMChannel));
        await command.channel.send(this.create_modmail_system_embed_and_components());
    }

    private async modmail_update(command: TextBasedCommand, message_id: string) {
        assert(command.channel && !(command.channel instanceof Discord.PartialGroupDMChannel));
        const target = await command.channel.messages.fetch(message_id);
        await target.edit(this.create_modmail_system_embed_and_components());
    }

    async increment_modmail_id() {
        const res = await this.database.component_state.findOneAndUpdate(
            { id: "moderation" },
            {
                $inc: {
                    modmail_id: 1,
                },
            },
            { upsert: true, returnDocument: "after" },
        );
        return unwrap(res).modmail_id;
    }

    async create_modmail_thread(interaction: Discord.ModalSubmitInteraction | Discord.ButtonInteraction) {
        try {
            try {
                // fetch full member
                assert(interaction.member);
                const member = await this.wheatley.guild.members.fetch(interaction.member.user.id);
                // make the thread
                const id = await this.increment_modmail_id();
                const thread = await this.rules.threads.create({
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
                await this.mods.send({
                    content: make_url(thread),
                    embeds: [notification_embed],
                });
                // add everyone
                await thread.members.add(member.id);
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
            this.wheatley.critical_error(e);
        }
    }

    create_modmail_system_embed_and_components() {
        const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.monkey_button.create_button().setLabel("I'm a monkey").setStyle(Discord.ButtonStyle.Primary),
            this.create_button.create_button().setLabel("Start a modmail thread").setStyle(Discord.ButtonStyle.Danger),
            this.not_monkey_button.create_button().setLabel("I'm not a monkey").setStyle(Discord.ButtonStyle.Secondary),
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

    async monkey_button_press(interaction: Discord.ButtonInteraction) {
        await interaction.reply({
            content:
                "Hello and welcome to Together C&C++ :wave: Please read before pressing buttons and only " +
                "use the modmail system when there is an __issue requiring staff attention__.",
            files: ["https://i.kym-cdn.com/photos/images/newsfeed/001/919/939/366.jpg"],
            ephemeral: true,
        });
        await this.log_action(interaction.member, "Monkey pressed the button");
        await this.database.monke_button_presses.insertOne({
            user: interaction.user.id,
            user_name: interaction.user.tag,
            timestamp: Date.now(),
        });
        try {
            if ((await this.wheatley.try_fetch_guild_member(interaction.user))?.manageable) {
                const member = await this.wheatley.guild.members.fetch(interaction.user.id);
                await member.roles.add(this.wheatley.roles.monke);
                this.monke_set.set(interaction.user.id, Date.now());
            }
        } catch (e) {
            this.wheatley.critical_error(e);
        }
    }

    async not_monkey_button_press(interaction: Discord.ButtonInteraction) {
        await interaction.deferReply({
            ephemeral: true,
        });
        await this.log_action(interaction.member, "Monkey pressed the not monkey button");
        const member = await this.wheatley.guild.members.fetch(interaction.user.id);
        if (member.roles.cache.has(this.wheatley.roles.monke.id)) {
            if (!this.monke_set.has(member.id) || Date.now() - unwrap(this.monke_set.get(member.id)) >= HOUR) {
                await interaction.editReply({
                    content: "Congratulations on graduating from your monke status.",
                });
                try {
                    if ((await this.wheatley.try_fetch_guild_member(interaction.user))?.manageable) {
                        await member.roles.remove(this.wheatley.roles.monke);
                        this.monke_set.remove(member.id);
                    }
                } catch (e) {
                    this.wheatley.critical_error(e);
                }
            } else {
                await interaction.editReply({
                    content: "You must wait at least an hour to remove your monke status.",
                });
            }
        } else {
            await interaction.editReply({
                content: "No monke role present. If you'd like to become a monke press the \"I'm a monke\" button.",
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
            if (await this.wheatley.is_established_member(interaction.user)) {
                // fast-path established members
                await interaction.deferReply({
                    ephemeral: true,
                });
                await this.create_modmail_thread(interaction);
                await interaction.editReply({
                    content:
                        "Your modmail request has been processed. A thread has been created and the staff " +
                        "team have been notified.",
                    components: [],
                });
                await this.log_action(interaction.member, "Modmail button pressed, fast path");
            } else {
                // make sure they can read
                const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    this.abort_button.create_button().setLabel("Cancel").setStyle(Discord.ButtonStyle.Primary),
                    this.continue_button.create_button().setLabel("Continue").setStyle(Discord.ButtonStyle.Danger),
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
        set_timeout(() => {
            this.timeout_set.delete(interaction.user.id);
        }, RATELIMIT_TIME);

        const modal = this.confirm_modal.create_modal();
        await interaction.showModal(modal);
        await this.log_action(interaction.member, "Modmail continue");
    }

    async modmail_modal_submit(interaction: BotModalSubmitInteraction) {
        const codeword = interaction.get_field_value("modmail_create_confirm_codeword");
        if (codeword.toLowerCase().replace(/\s/g, "").includes("raboof")) {
            await interaction.deferUpdate();
            await this.create_modmail_thread(interaction.raw_interaction);
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

    async log_action(
        interaction_member: Discord.GuildMember | Discord.APIInteractionGuildMember | null,
        title: string,
        body?: string,
    ) {
        const [tag, avatar] = await (async () => {
            if (interaction_member) {
                const member = await this.wheatley.guild.members.fetch(interaction_member.user.id);
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
        await this.staff_member_log.send({
            embeds: [embed],
        });
    }
}
