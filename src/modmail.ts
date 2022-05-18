import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, get_url_for, M } from "./utils";
import { is_authorized_admin, member_log_channel_id, MINUTE, mods_channel_id, root_mod_ids, rules_channel_id, TCCPP_ID, zelis_id } from "./common";
import { DatabaseInterface } from "./database_interface";

let client: Discord.Client;

let TCCPP : Discord.Guild;
let rules_channel: Discord.TextChannel;
let mods_channel: Discord.TextChannel;
let staff_member_log_channel: Discord.TextChannel;

let database: DatabaseInterface;

type database_schema = number;

let modmail_id_counter = 0;

const RATELIMIT_TIME = MINUTE;
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
        // TODO: Give users a means to close / archive modmail threads
    } catch(e) {
        critical_error(e);
    }
}

async function update_db() {
    database.set<database_schema>("modmail_id_counter", modmail_id_counter);
    await database.update();
}

async function handle_monkey(interaction: Discord.ButtonInteraction) {
    /*await interaction.deferReply({
        ephemeral: true
    });
    assert(interaction.member);
    const member = await TCCPP.members.fetch(interaction.member.user.id);
    const thread = await create_modmail_thread(member);
    await thread.send({
        embeds: [create_embed("Modmail", "Hello and welcome to Together C&C++. These buttons are for __modmail__, please only use this system when there is an issue requiring staff attention. Please read before pressing the buttons :wink: Feel free to leave this thread.")]
    });
    await thread.members.add(member.id);
    await interaction.editReply({
        content: "Hello, monkey :)"
    });*/
    await interaction.reply({
        content: "Hello and welcome to Together C&C++ :wave: Please read before pressing buttons and only use the modmail system system when there is an __issue requiring staff attention__.",
        ephemeral: true
    });
    assert(interaction.member);
    const member = await TCCPP.members.fetch(interaction.member.user.id);
    await staff_member_log_channel.send({
        embeds: [create_embed("Monkey", "Monkey pressed the button").setAuthor({
            name: member.user.tag,
            iconURL: member.displayAvatarURL()
        })]
    });
}

async function create_modmail_thread(interaction: Discord.ButtonInteraction) {
    try {
        // respond right away
        await interaction.deferReply({
            ephemeral: true
        });
        // fetch full member
        assert(interaction.member);
        const member = await TCCPP.members.fetch(interaction.member.user.id);
        // make the thread
        const id = modmail_id_counter++;
        update_db();
        const thread =  await rules_channel.threads.create({
            type: "GUILD_PRIVATE_THREAD",
            invitable: false,
            name: `Modmail #${id}`
        });
        // initial message
        await thread.send({
            embeds: [create_embed("Modmail", "Hello, thank you for reaching out. The staff team can view this thread and will respond as soon as possible.")]
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
        // add members
        // TODO: Any way to do this without ping?
        //for(const id of [member.id, ...root_mod_ids]) {
        for(const id of [member.id, zelis_id]) {
            await thread.members.add(id, "test reason? FIXME");
        }
        // Indicate success
        await interaction.editReply({
            content: "Your modmail request has been processed. A thread has been created and the staff team have been notified."
        });
    } catch(e) {
        await interaction.editReply({
            content: "Something went wrong internally..."
        })
        // FIXME: RETHROW
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    try {
        if(!interaction.isButton()) return;
        if(interaction.customId == "modmail_monkey") {
            await handle_monkey(interaction);
        }
        if(interaction.customId == "modmail_create") {
            if(timeout_set.has(interaction.user.id)) {
                await interaction.reply({
                    ephemeral: true,
                    content: "Please don't spam modmail requests"
                });
            } else {
                timeout_set.add(interaction.user.id);
                await create_modmail_thread(interaction);
                setTimeout(() => {
                    timeout_set.delete(interaction.user.id);
                }, RATELIMIT_TIME);
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
