import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

export default class Status extends BotComponent {
    override async on_ready() {
        this.wheatley.client.user?.setActivity({
            name: "C & C++ | !help",
            type: Discord.ActivityType.Playing,
        });
    }
}
