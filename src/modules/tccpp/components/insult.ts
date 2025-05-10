import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../../../bot-component.js";

export default class Insult extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    has_unkind_words(message: Discord.Message) {
        return (
            message.content.match(/shut up/gi) ||
            message.content.match(/bad bot/gi) ||
            message.content.match(/get a life/gi) ||
            message.content.match(/fuck (off|you)/gi)
        );
    }

    override async on_message_create(message: Discord.Message) {
        let is_unkind = false;
        if (message.mentions.has(this.wheatley.user.id)) {
            if (message.content.match(/\bk\s*y\s*s\b/gi)) {
                await message.reply("Please don't say that");
                return;
            }
            if (this.has_unkind_words(message)) {
                is_unkind = true;
            }
        } else {
            if (this.has_unkind_words(message) && message.content.match(/wheatley/gi)) {
                is_unkind = true;
            }
        }
        if (is_unkind) {
            await message.reply({
                files: ["https://i.pinimg.com/736x/b4/26/17/b42617b777837f1cb6f189b434492a7e.jpg"],
            });
        }
    }
}
