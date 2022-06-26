import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, get_url_for, M } from "./utils";
import { is_authorized_admin, member_log_channel_id, MINUTE, moderators_role_id, mods_channel_id, rules_channel_id, TCCPP_ID } from "./common";
import { DatabaseInterface } from "./database_interface";
import { APIInteractionGuildMember } from "discord-api-types/v10";

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


let client: Discord.Client;

let TCCPP : Discord.Guild;
let rules_channel: Discord.TextChannel;
let mods_channel: Discord.TextChannel;
let staff_member_log_channel: Discord.TextChannel;

let database: DatabaseInterface;

type database_schema = number;

let modmail_id_counter = 0;

const RATELIMIT_TIME = 5 * MINUTE;
const timeout_set = new Set<string>();

const color = 0x7E78FE;

function create_embed(title: string, msg: string) {
    const embed = new Discord.MessageEmbed()
        .setColor(color)
        .setTitle(title)
        .setDescription(msg);
    return embed;
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!wsetupmodmailsystem"
        && is_authorized_admin(message.member!)) {
            const row = new Discord.MessageActionRow()
                .addComponents(
                    new Discord.MessageButton()
                        .setCustomId("modmail_monkey")
                        .setLabel("I'm a monkey")
                        .setStyle("PRIMARY"),
                    new Discord.MessageButton()
                        .setCustomId("modmail_create")
                        .setLabel("Start a modmail thread")
                        .setStyle("DANGER"),
                );
            message.channel.send({
                embeds: [create_embed("Modmail", "If you have a **moderation** or **administration** related issue you can reach out to the staff team by pressing the modmail thread button below.\n\nBecause, in our experience, a surprising number of users also can't read, there is also a monkey button.")],
                components: [row]
            });
        }
        if(message.content == "!archive") {
            if(message.channel.isThread()
            && message.channel.parentId == rules_channel_id
            && message.channel.type == "GUILD_PRIVATE_THREAD") {
                await message.channel.setArchived();
            } else {
                message.reply("You can't use that here");
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function update_db() {
    database.set<database_schema>("modmail_id_counter", modmail_id_counter);
    await database.update();
}

async function log_action(interaction_member: Discord.GuildMember | APIInteractionGuildMember | null,
                          title: string, body?: string) {
    const [tag, avatar] = await (async () => {
        if(interaction_member) {
            const member = await TCCPP.members.fetch(interaction_member.user.id);
            return [member.user.tag, member.displayAvatarURL()];
        } else {
            return ["NULL", undefined];
        }
    })();
    M.log("Modmail log:", tag, title);
    const embed = new Discord.MessageEmbed()
        .setColor(color)
        .setTitle(title)
        .setAuthor({
            name: tag,
            iconURL: avatar
        });
    if(body) embed.setDescription(body);
    await staff_member_log_channel.send({
        embeds: [embed]
    });
}

async function create_modmail_thread(interaction: Discord.ModalSubmitInteraction) {
    try {
        // fetch full member
        assert(interaction.member);
        const member = await TCCPP.members.fetch(interaction.member.user.id);
        // make the thread
        const id = modmail_id_counter++;
        update_db();
        const thread =  await rules_channel.threads.create({
            type: "GUILD_PRIVATE_THREAD",
            invitable: false,
            name: `Modmail #${id}`,
            autoArchiveDuration: "MAX"
        });
        // initial message
        await thread.send({
            embeds: [create_embed("Modmail", "Hello, thank you for reaching out. The staff team can view this thread and will respond as soon as possible. When the issue is resolved, use `!archive` to archive the thread.")]
        });
        // send notification in mods channel
        const notification_embed = create_embed("Modmail Thread Created", `<#${thread.id}>`);
        notification_embed.setAuthor({
            name: member.user.tag,
            iconURL: member.displayAvatarURL()
        });
        await mods_channel.send({
            content: get_url_for(thread),
            embeds: [notification_embed]
        });
        // add everyone
        await thread.members.add(member.id);
        // Deliberately not awaiting here
        await thread.send({
            content: `<@&${moderators_role_id}>`,
            allowedMentions: {
                roles: [moderators_role_id]
            }
        });
    } catch(e) {
        await interaction.update({
            content: "Something went wrong internally...",
            components: []
        })
        throw e; // rethrow
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    try {
        if(interaction.isButton()) {
            if(interaction.customId == "modmail_monkey") {
                await interaction.reply({
                    content: "Hello and welcome to Together C&C++ :wave: Please read before pressing buttons and only use the modmail system system when there is an __issue requiring staff attention__.",
                    ephemeral: true
                });
                await log_action(interaction.member, "Monkey pressed the button");
            } else if(interaction.customId == "modmail_create") {
                if(timeout_set.has(interaction.user.id)) {
                    await interaction.reply({
                        ephemeral: true,
                        content: "Please don't spam modmail requests -- This button has a 5 minute cooldown"
                    });
                    await log_action(interaction.member, "Modmail button spammed");
                } else {
                    const row = new Discord.MessageActionRow()
                        .addComponents(
                            new Discord.MessageButton()
                                .setCustomId("modmail_create_abort")
                                .setLabel("Cancel")
                                .setStyle("PRIMARY"),
                            new Discord.MessageButton()
                                .setCustomId("modmail_create_continue")
                                .setLabel("Continue")
                                .setStyle("DANGER"),
                        );
                    await interaction.reply({
                        ephemeral: true,
                        content: "Please only submit a modmail request if you have a server issue requiring staff attention! If you really intend to submit a modmail request enter the word \"foobar\" backwards when prompted",
                        components: [row],
                    });
                    await log_action(interaction.member, "Modmail button pressed");
                }
            } else if(interaction.customId == "modmail_create_abort") {
                await interaction.update({
                    content: "All good :+1:",
                    components: []
                });
                await log_action(interaction.member, "Modmail abort sequence");
            } else if(interaction.customId == "modmail_create_continue") {
                timeout_set.add(interaction.user.id);
                setTimeout(() => {
                    timeout_set.delete(interaction.user.id);
                }, RATELIMIT_TIME);
                const modal = new Discord.Modal()
                        .setCustomId("modmail_create_confirm")
                        .setTitle("Confirm Modmail");
                const row = new Discord.MessageActionRow<Discord.ModalActionRowComponent>()
                    .addComponents(
                        new Discord.TextInputComponent()
                            .setCustomId("modmail_create_confirm_codeword")
                            .setLabel("Codeword")
                            .setPlaceholder("You'll know if you read the last message")
                            .setStyle("SHORT")
                    );
                modal.addComponents(row);
                await interaction.showModal(modal);
                await log_action(interaction.member, "Modmail continue");
            }
        } else if(interaction.isModalSubmit()) {
            if(interaction.customId == "modmail_create_confirm") {
                const codeword = interaction.fields.getTextInputValue("modmail_create_confirm_codeword");
                if(codeword.toLowerCase().replace(/\s/g, "").includes("raboof")) {
                    await interaction.deferUpdate();
                    await create_modmail_thread(interaction);
                    await interaction.editReply({
                        content: "Your modmail request has been processed. A thread has been created and the staff team have been notified.",
                        components: []
                    });
                    await log_action(interaction.member, "Modmail submit");
                } else {
                    interaction.update({
                        content: "Codeword was incorrect, do you really mean to start a modmail thread?",
                        components: []
                    });
                    await log_action(interaction.member, "Modmail incorrect codeword");
                }
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_ready() {
    try {
        TCCPP = await client.guilds.fetch(TCCPP_ID);
        rules_channel = await client.channels.fetch(rules_channel_id) as Discord.TextChannel;
        mods_channel = await client.channels.fetch(mods_channel_id) as Discord.TextChannel;
        staff_member_log_channel = await client.channels.fetch(member_log_channel_id) as Discord.TextChannel;
        client.on("messageCreate", on_message);
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_modmail(_client: Discord.Client, _database: DatabaseInterface) {
    try {
        client = _client;
        database = _database;
        if(!database.has("modmail_id_counter")) {
            database.set<database_schema>("modmail_id_counter", modmail_id_counter);
        } else {
            // load entries
            modmail_id_counter = database.get<database_schema>("modmail_id_counter");
        }
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
