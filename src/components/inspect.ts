import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MessageContextMenuCommandBuilder } from "../command.js";

export class Inspect extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new MessageContextMenuCommandBuilder("Inspect")
                .set_handler(this.inspect.bind(this))
        );
    }

    async inspect(interaction: Discord.MessageContextMenuCommandInteraction) {
        M.log("Received inspect command");
        await interaction.reply({
            ephemeral: true,
            content: interaction.targetMessage.content.length > 0 ?
                Discord.escapeMarkdown(interaction.targetMessage.content).replace(/[<>]/g, c => `\\${c}`)
                : "<empty>"
        });
        if(interaction.targetMessage.attachments.size > 0) {
            await interaction.followUp({
                ephemeral: true,
                content: JSON.stringify(interaction.targetMessage.attachments.map(x => x), null, 4)
            });
        }
        if(interaction.targetMessage.embeds.length > 0) {
            await interaction.followUp({
                ephemeral: true,
                content: JSON.stringify(interaction.targetMessage.embeds, null, 4)
            });
        }
    }
}
