import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils.js";
import { is_authorized_admin } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

/**
 * Provides TCCPP-specific utilities for renaming channels etc.
 */
export default class UtilityTools extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot) return; // Ignore bots
        if (is_authorized_admin(message.author)) {
            if (message.content == "!channel-rename") {
                M.info("got !channel-rename");
                const m = await message.channel.send("working...");
                const channels = await this.wheatley.TCCPP.channels.fetch();
                for (const [_, channel] of channels) {
                    assert(channel);
                    const r = channel.name.replace(/_/g, "-");
                    M.info("Renaming", channel.name, r);
                    await channel.setName(r);
                }
                M.info("Done");
                await m.edit(":+1:");
            } else if (message.content == "!sync-archive-permissions") {
                M.info("got !sync-archive-permissions");
                const archive = await this.wheatley.TCCPP.channels.fetch("910306041969913938");
                assert(archive instanceof Discord.CategoryChannel);
                for (const [_, channel] of archive.children.cache) {
                    await channel.lockPermissions();
                }
                await message.reply("Done");
            } else if (message.content == "!prefix-archive-channels") {
                M.info("got !prefix-archive-channels");
                for (const id of [
                    "910306041969913938",
                    "455278783352537099",
                    "429594248099135488",
                    "910308747929321492",
                ]) {
                    const archive = await this.wheatley.TCCPP.channels.fetch(id);
                    assert(archive instanceof Discord.CategoryChannel);
                    for (const [_, channel] of archive.children.cache) {
                        if (!channel.name.startsWith("archived-")) {
                            await channel.setName(`archived-${channel.name}`);
                        }
                    }
                }
                await message.reply("Done");
            }
        }
    }
}
