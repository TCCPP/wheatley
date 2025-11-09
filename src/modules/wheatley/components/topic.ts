import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley, create_error_reply } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { build_description } from "../../../utils/strings.js";

export default class Topic extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("topic", EarlyReplyMode.none)
                .set_category("Misc")
                .set_description("Posts the channel topic")
                .set_handler(this.topic.bind(this)),
        );
    }

    async topic(command: TextBasedCommand) {
        const channel = await command.get_channel();
        if (channel.isDMBased() || channel.isThread() || channel.isVoiceBased()) {
            await command.reply("Must be used in a guild text-based non-thread channel");
            return;
        }
        if (channel.topic) {
            await command.reply(channel.topic);
        } else {
            await command.reply("No channel description set");
        }
    }
}
