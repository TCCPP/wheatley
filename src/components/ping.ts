import * as Discord from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

import { strict as assert } from "assert";

import { critical_error, M } from "../utils";
import { is_authorized_admin } from "../common";
import { GuildCommandManager } from "../infra/guild_command_manager";
import { make_message_deletable } from "./deletable";

let client: Discord.Client;

const color = 0x7E78FE; //0xA931FF;

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!wping"
        || message.content == "!wstatus"
        && is_authorized_admin(message.member!)) {
            M.log("Received ping command");
            const reply = await message.channel.send({embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color)
                    .setTitle("pong")
            ]});
            make_message_deletable(message, reply);
        }
    } catch(e) {
        critical_error(e);
        try {
            message.reply("Internal error while replying to !wping");
        } catch(e) {
            critical_error(e);
        }
    }
}

async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && interaction.commandName == "echo") {
        assert(interaction.isChatInputCommand());
        const input = interaction.options.getString("input");
        M.debug("Received echo command", input);
        await interaction.reply({
            ephemeral: true,
            content: input || undefined
        });
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_ping(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    try {
        client = _client;
        const echo = new SlashCommandBuilder()
            .setName("echo")
            .setDescription("Echo")
            .addStringOption(option =>
                option.setName("input")
                    .setDescription("The input to echo back")
                    .setRequired(true));
        guild_command_manager.register(echo);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
