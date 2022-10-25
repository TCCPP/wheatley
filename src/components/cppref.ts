import * as Discord from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

import { strict as assert } from "assert";

import * as fs from "fs";

import { critical_error, M } from "../utils";
import { is_authorized_admin } from "../common";
import { GuildCommandManager } from "../infra/guild_command_manager";

import { cppref_index, cppref_page } from "../../cppref/types";
import { weighted_levenshtein } from "../algorithm/levenshtein";
import { Index } from "../algorithm/search";


let client: Discord.Client;

let c_index: Index<cppref_page>;
let cpp_index: Index<cppref_page>;

const color = 0x7289DA; // todo: use ping color? make this common?

export enum TargetIndex { C, CPP }

export function lookup(query: string, target: TargetIndex) {
    return (target == TargetIndex.C ? c_index : cpp_index).search(query);
}

async function on_message(message: Discord.Message) {
    try {
        if(message.author.bot) return; // Ignore bots
        if(message.content.startsWith(".cref ") && is_authorized_admin(message.member!)) {
            const query = message.content.slice(".cref".length).trim();
        }
        if(message.content.startsWith(".cppref") && is_authorized_admin(message.member!)) {
            const query = message.content.slice(".cppref".length).trim();
            const result = lookup(query, TargetIndex.CPP);
            M.debug("cppref", [query, result]);
            message.channel.send({embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color)
                    .setAuthor({
                        name: "cppreference.com",
                        iconURL: "https://en.cppreference.com/favicon.ico",
                        url: "https://en.cppreference.com"
                    })
                    .setTitle("foobar")
                    .setURL("https://en.cppreference.com/w/cpp/container/unordered_map/insert")
                    .addFields({
                        name: "Defined in",
                        value: "<test>"
                    })
            ]});
        }
    } catch(e) {
        critical_error(e);
    }
}

/*async function on_interaction_create(interaction: Discord.Interaction) {
    if(interaction.isCommand() && interaction.commandName == "echo") {
        assert(interaction.isChatInputCommand());
        const input = interaction.options.getString("input");
        M.debug("echo command", input);
        await interaction.reply({
            ephemeral: true,
            content: input || undefined
        });
    }
}*/

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        //client.on("interactionCreate", on_interaction_create);
    } catch(e) {
        critical_error(e);
    }
}



export function cppref_testcase_setup() {
    const index_data = JSON.parse(fs.readFileSync("cppref/cppref_index.json", {encoding: "utf-8"})) as cppref_index;
    //for(const pages of [index.c, index.cpp]) {
    //    for(const page of pages) {
    //        if(DEBUG) console.log(page.title.split(",").map(x => x.trim()));
    //    }
    //}
    c_index = new Index(index_data.c);
    cpp_index = new Index(index_data.cpp);
}

export async function setup_cppref(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    try {
        client = _client;
        /*const echo = new SlashCommandBuilder()
            .setName("echo")
            .setDescription("Echo")
            .addStringOption(option =>
                option.setName("input")
                    .setDescription("The input to echo back")
                    .setRequired(true));
        guild_command_manager.register(echo);*/
        const index_data = JSON.parse(
            await fs.promises.readFile("cppref/cppref_index.json", {encoding: "utf-8"})
        ) as cppref_index;
        c_index = new Index(index_data.c);
        cpp_index = new Index(index_data.cpp);
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
