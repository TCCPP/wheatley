import * as Discord from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

import { strict as assert } from "assert";

import { critical_error, M } from "../utils";
import { ApplicationCommandTypeMessage, is_authorized_admin } from "../common";
import { GuildCommandManager } from "../infra/guild_command_manager";
import { make_message_deletable } from "./deletable";
import { ContextMenuCommandBuilder } from "discord.js";

let client: Discord.Client;

async function on_interaction_create(interaction: Discord.Interaction) {
    try {
        if(interaction.isMessageContextMenuCommand() && interaction.commandName == "inspect") {
            M.debug("inspect command");
            await interaction.reply({
                ephemeral: true,
                content: Discord.escapeMarkdown(interaction.targetMessage.content).replace(/[<>]/g, c => `\\${c}`) || undefined
            });
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_ready() {
    try {
        client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_inspect(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    try {
        client = _client;
        const inspect = new ContextMenuCommandBuilder()
            .setName("inspect")
            .setType(ApplicationCommandTypeMessage);
        guild_command_manager.register(inspect);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
