import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils";
import { BotComponent } from "../bot_component";
import { colors } from "../common";

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

export class AntiForumPostDelete extends BotComponent {
    override async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        if(message.channel.id == message.id) {
            M.log(`Firing AntiForumPostDelete on ${message.channel.url}`);
            await message.channel.send({
                content: `<@${message.author?.id}>`,
                embeds: [
                    create_embed(
                        "Please Do Not Delete Posts!",
                        colors.red,
                        "Please don't delete forum posts. They can be helpful to refer to later and other members can"
                        + " learn from them. You can use `!solved` to close a post and mark it as solved."
                    )
                ]
            });
        }
    }
}
