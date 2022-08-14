/** sensitive */
import * as Discord from "discord.js";
import { REST } from "@discordjs/rest";
import { PermissionFlagsBits, Routes } from "discord-api-types/v9";
import { SlashCommandBuilder, ContextMenuCommandBuilder } from "@discordjs/builders";

import { readFileSync } from "fs";

import { strict as assert } from "assert";
import { M } from "../utils";
import { ApplicationCommandTypeMessage, colors, is_authorized_admin, TCCPP_ID, wheatley_id } from "../common";

let client: Discord.Client;

function on_message(message: Discord.Message) {

}

export async function setup_test_module(_client: Discord.Client) {
    client = _client;
    client.on("messageCreate", on_message);
}
