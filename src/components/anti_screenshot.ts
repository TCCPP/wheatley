import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { critical_error, delay, M } from "../utils";
import { colors, has_skill_roles_other_than_beginner, is_authorized_admin, is_forum_help_thread, wheatley_id, zelis_id } from "../common";
import { make_message_deletable } from "./deletable";

let client: Discord.Client;
let zelis : Discord.User;

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

function are_images({contentType}: {contentType: string | null}) {
    assert(contentType);
    return contentType.startsWith("image/");
}

function are_text({contentType}: {contentType: string | null}) {
    assert(contentType);
    return contentType.startsWith("text/");
}

function message_might_have_code(message: string) {
    return message.includes("```") || message.match(/[{};]/g);
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    try {
        if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
            return;
        }
        if(is_forum_help_thread(thread)) { // TODO
            const forum = thread.parent;
            assert(forum instanceof Discord.ForumChannel);
            await delay(1100);
            const starter_message = await thread.fetchStarterMessage();
            assert(starter_message);
            assert(starter_message.member);
            // trust people with skill roles
            if(has_skill_roles_other_than_beginner(starter_message.member)) {
                M.debug("skipping.....");
                return;
            }
            // check if it has images and no code
            if(starter_message.attachments.some(are_images)
            && !starter_message.attachments.some(are_text)
            && !message_might_have_code(starter_message.content)) {
                const row = new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>()
                    .addComponents(
                        new Discord.ButtonBuilder()
                            .setCustomId("anti_screenshot_acknowledge")
                            .setLabel("Acknowledge")
                            .setStyle(Discord.ButtonStyle.Primary)
                    );
                await thread.send({
                    content: `<@${thread.ownerId}>`,
                    embeds: [create_embed("Screenshots!", colors.red, "Your message appears to contain screenshots"
                        + " but no code. Please send code and error messages in text instead of screenshots if"
                        + " applicable!")],
                    components: [row]
                });
                await zelis.send({
                    content: `${thread.url}\n\n${starter_message.content}`
                });
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    try {
        if(interaction.isButton()) {
            if(interaction.customId == "anti_screenshot_acknowledge"
            && interaction.user.id == (interaction.channel as Discord.ThreadChannel).ownerId) {
                await interaction.message.delete();
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_ready() {
    try {
        zelis = await client.users.fetch(zelis_id);
        client.on("threadCreate", on_thread_create);
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_anti_screenshot(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
