import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley, create_error_reply } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { build_description } from "../utils/strings.js";
import { KeyedMutexSet } from "../utils/containers.js";
import { unwrap } from "../utils/misc.js";

export default class PinArchive extends BotComponent {
    mutex = new KeyedMutexSet<string>();

    constructor(wheatley: Wheatley) {
        super(wheatley);

        wheatley.client.on("channelPinsUpdate", this.on_pin_update.bind(this));
    }

    on_pin_update(channel: Discord.TextBasedChannel, time: Date) {
        M.log("Got channelPinsUpdate update", channel.url);
        this.update_for_channel(channel).catch(this.wheatley.critical_error.bind(this.wheatley));
    }

    async post_to_pin_archive(message: Discord.Message) {
        await this.mutex.lock(message.id);
        // TODO: Essentially the same as update_starboard
        try {
            const make_embeds = () =>
                this.utilities.make_quote_embeds([message], {
                    template: "\n\n**[Jump to message]($$)**",
                });
            const pin_archive_entry = await this.wheatley.database.pin_archive.findOne({ source_message: message.id });
            if (pin_archive_entry) {
                // edit
                let pin_archive_message;
                try {
                    pin_archive_message = await this.wheatley.channels.pin_archive.messages.fetch(
                        pin_archive_entry.archive_message,
                    );
                } catch (e: any) {
                    // unknown message
                    if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
                        return;
                    } else {
                        throw e;
                    }
                }
                await pin_archive_message.edit({
                    content: `<#${message.channel.id}>`,
                    ...(await make_embeds()),
                });
            } else {
                // send
                try {
                    const archive_message = await this.wheatley.channels.pin_archive.send({
                        content: `<#${message.channel.id}>`,
                        ...(await make_embeds()),
                    });
                    await this.wheatley.database.pin_archive.insertOne({
                        archive_message: archive_message.id,
                        source_channel: message.channel.id,
                        source_message: message.id,
                    });
                } catch (e) {
                    this.wheatley.critical_error(e);
                }
            }
        } finally {
            this.mutex.unlock(message.id);
        }
    }

    async update_for_channel(channel: Discord.TextBasedChannel) {
        if (
            channel.isDMBased() ||
            channel.guildId != this.wheatley.TCCPP.id ||
            !(await this.wheatley.is_public_channel(channel))
        ) {
            return;
        }
        const current_pins = await channel.messages.fetchPinned();
        const database_current_pins = await this.wheatley.database.pins
            .find({ channel: channel.id, current_pin: true })
            .toArray();
        // two things to handle: new pins and pins that are now no longer pins
        // ensure current pins are marked as such
        for (const [_, message] of current_pins) {
            const res = await this.wheatley.database.pins.updateOne(
                { channel: channel.id, message: message.id },
                { $set: { current_pin: true } },
                { upsert: true },
            );
            assert(res.acknowledged);
        }
        // look for returned pins that are no longer pins
        for (const pin of database_current_pins) {
            if (!current_pins.has(pin.message)) {
                const channel = await this.wheatley.TCCPP.channels.fetch(pin.channel);
                assert(channel && channel.isTextBased());
                const message = await channel.messages.fetch(pin.message);
                M.debug("unpinned message", message.content);
                await this.post_to_pin_archive(message);
                const res = await this.wheatley.database.pins.updateOne(
                    { channel: channel.id, message: pin.message },
                    { $set: { current_pin: false } },
                );
                assert(res.acknowledged);
            }
        }
    }

    async recover() {
        this.wheatley.info("Pin archive: Scanning channels");
        const channels = await this.wheatley.TCCPP.channels.fetch();
        for (const channel of channels.values()) {
            if (channel && channel.isTextBased()) {
                await this.update_for_channel(channel);
            }
        }
        this.wheatley.info("Pin archive: Finished recovery");
    }

    override async on_ready() {
        this.recover().catch(this.wheatley.critical_error.bind(this.wheatley));
    }
}
