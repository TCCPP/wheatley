import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { build_description } from "../utils/strings.js";

/**
 * !code and formatting help
 */
export default class Code extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("code")
                .set_description("code formatting help")
                .set_handler(this.code.bind(this)),
        );
    }

    async code(command: TextBasedCommand) {
        M.log("Received code command");
        const is_c = [this.wheatley.channels.c_help.id, this.wheatley.channels.c_help_text.id].includes(
            this.wheatley.top_level_channel(await command.get_channel()),
        );
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle("How to Format Code on Discord")
                    .addFields(
                        {
                            name: "Markup",
                            inline: true,
                            value: build_description(
                                `\\\`\\\`\\\`${is_c ? "c" : "cpp"}`,
                                `int main() {}`,
                                `\\\`\\\`\\\``,
                            ),
                        },
                        {
                            name: "Result",
                            inline: true,
                            value: build_description(`\`\`\`${is_c ? "c" : "cpp"}`, `int main() {}`, `\`\`\``),
                        },
                    )
                    .setFooter({
                        text: "Note: Back-tick (`) not quotes (')",
                    }),
            ],
        });
    }
}
