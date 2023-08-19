import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { M, delay } from "../utils.js";
import { TextBasedCommandBuilder } from "../command-abstractions/builders/text-based.js";
import { TextBasedCommand } from "../command-abstractions/interfaces/text-based.js";

/**
 * Adds the /redirect command for redirecting conversations between channels.
 */
export default class Redirect extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("redirect")
                .set_description("Redirect a conversation")
                .add_string_option({
                    title: "channel",
                    description: "channel",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.Administrator)
                .set_handler(this.redirect.bind(this)),
        );
    }

    async redirect(command: TextBasedCommand, arg: string) {
        M.log("Redirect command received");
        assert(command.channel);
        assert(command.channel instanceof Discord.GuildChannel);
        const initial_permissions = command.channel.permissionOverwrites.cache.clone();
        await command.channel.permissionOverwrites.edit(this.wheatley.TCCPP.id, { SendMessages: false });
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Channel Locked")
                    .setDescription(
                        `Please move the current conversation to ${arg}.` +
                            "\nThe channel will be unlocked in 30 seconds.",
                    )
                    .setColor(colors.wheatley),
            ],
        });
        await delay(30 * 1000);
        await command.channel.permissionOverwrites.set(initial_permissions);
        //await command.channel.permissionOverwrites.edit(TCCPP_ID, { SendMessages: null });
    }
}
