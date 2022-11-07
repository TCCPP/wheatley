import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils";
import { tutoring_id, tutoring_requests_id } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

const color = 0xF34A39;

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
            this.wheatley.deletable.make_message_deletable(message, reply);
        }
    }
}
