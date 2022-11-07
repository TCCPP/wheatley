import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils";
import { ApplicationCommandTypeMessage } from "../common";
import { ContextMenuCommandBuilder } from "discord.js";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

export class Inspect extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        const inspect = new ContextMenuCommandBuilder()
            .setName("inspect")
            .setType(ApplicationCommandTypeMessage);
        this.wheatley.guild_command_manager.register(inspect);
    }

    override async on_interaction_create(interaction: Discord.Interaction) {
        if(interaction.isMessageContextMenuCommand() && interaction.commandName == "inspect") {
            M.log("Received inspect command");
            await interaction.reply({
                ephemeral: true,
                content: Discord.escapeMarkdown(interaction.targetMessage.content).replace(/[<>]/g, c => `\\${c}`)
                    || undefined
            });
        }
    }
}
