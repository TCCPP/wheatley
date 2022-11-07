import * as Discord from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";

import { strict as assert } from "assert";

import { critical_error, M } from "../utils";
import { colors, is_authorized_admin } from "../common";
import { GuildCommandManager } from "../infra/guild_command_manager";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

export class Ping extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        const echo = new SlashCommandBuilder()
            .setName("echo")
            .setDescription("Echo")
            .addStringOption(option =>
                option.setName("input")
                    .setDescription("The input to echo back")
                    .setRequired(true));
        this.wheatley.guild_command_manager.register(echo);
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!wping"
        || message.content == "!wstatus"
        && is_authorized_admin(message.member!)) {
            M.log("Received ping command");
            const reply = await message.channel.send({ embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.color)
                    .setTitle("pong")
            ] });
            this.wheatley.deletable.make_message_deletable(message, reply);
        }
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
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
}
