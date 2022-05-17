import * as Discord from "discord.js";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { SlashCommandBuilder } from "@discordjs/builders";

import { readFileSync } from "fs";

import { strict as assert } from "assert";
import { M } from "./utils";
import { color, is_authorized_admin, TCCPP_ID, wheatley_id } from "./common";

let client: Discord.Client;

function on_message(message: Discord.Message) {

}

export async function setup_test_module(_client: Discord.Client) {
    client = _client;
    client.on("messageCreate", on_message);

    const token = readFileSync("auth.key", { encoding: "utf-8" });

    const echo = new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Replies with your input!')
        .addStringOption(option =>
            option.setName('input')
                .setDescription('The input to echo back')
                .setRequired(true));
    const commands = [echo];
    const rest = new REST({ version: "9" }).setToken(token);

    const clientId = wheatley_id;
    const guildId = TCCPP_ID;

    (async () => {
        try {
            console.log("Started refreshing application (/) commands.");

            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commands },
            );

            console.log("Successfully reloaded application (/) commands.");
        } catch (error) {
            console.error(error);
        }
    })();
}
