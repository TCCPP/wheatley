import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils.js";
import { tutoring_id, tutoring_requests_id } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

const color = 0xF34A39;

/**
 * Informs a user how to use the tutoring service.
 *
 * Not freestanding.
 */
export class ReadTutoring extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.channel.id == tutoring_requests_id) {
            M.log("Sending read tutoring message", message.author.id, message.author.tag, message.url);
            const reply = await message.reply({ embeds: [
                new Discord.EmbedBuilder()
                    .setColor(color)
                    .setTitle("Read The Instructions")
                    .setDescription(`Hello :wave:, please read <#${tutoring_id}> and then use /tutoring to request one`
                        + " on one tutoring. Don't hesitate to ask specific questions in our help channels too!")
            ] });
            this.wheatley.make_deletable(message, reply);
        }
    }
}
