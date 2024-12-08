import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../bot-component.js";

export default class Insult extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async on_message_create(message: Discord.Message) {
        if (message.mentions.has(this.wheatley.id)) {
            if (message.content.match(/\bk\s*y\s*s\b/gi)) {
                await message.reply("Please don't say that");
                return;
            }
            if (
                message.content.match(/shut up/gi) ||
                message.content.match(/bad bot/gi) ||
                message.content.match(/get a life/gi) ||
                message.content.match(/fuck (off|you)/gi)
            ) {
                await message.reply({
                    files: ["https://i.pinimg.com/736x/b4/26/17/b42617b777837f1cb6f189b434492a7e.jpg"],
                });
            }
        }
    }
}
