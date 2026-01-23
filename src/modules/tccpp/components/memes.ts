import * as Discord from "discord.js";
import { strict as assert } from "assert";

import { SECOND } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { departialize } from "../../../utils/discord.js";
import { has_media } from "./autoreact.js";
import { SelfClearingMap } from "../../../utils/containers.js";
import { clear_timeout, set_timeout } from "../../../utils/node.js";
import { MessageData } from "../../../bot-utilities.js";

const DISABLED: boolean = true;

const GRACE_PERIOD = 10 * SECOND;

export default class Memes extends BotComponent {
    // Map of message ID -> timeout handle for pending deletions
    private readonly pending_deletions = new SelfClearingMap<string, NodeJS.Timeout>(
        GRACE_PERIOD + 5 * SECOND,
        undefined,
        (_key, timeout) => {
            clear_timeout(timeout);
        },
    );

    private async should_skip(message: Discord.Message): Promise<boolean> {
        return (
            message.author.bot ||
            (await this.wheatley.check_permissions(message.author, Discord.PermissionFlagsBits.ModerateMembers))
        );
    }

    private async delete_message(message: Discord.Message) {
        try {
            const fresh_message = await message.channel.messages.fetch(message.id);
            if (has_media(fresh_message)) {
                return;
            }
            const message_data = await this.utilities.get_raw_message_data(fresh_message);
            await fresh_message.delete();
            assert(message.channel.isTextBased() && !(message.channel instanceof Discord.PartialGroupDMChannel));
            await this.send_deletion_dm(message.author, message_data);
        } catch (e) {
            // Ignore "Unknown Message" - message was already deleted
            if (!(e instanceof Discord.DiscordAPIError && e.code === 10008)) {
                throw e;
            }
        }
    }

    private async send_deletion_dm(user: Discord.User, message_data: MessageData) {
        try {
            const quote = await this.utilities.make_quote_embeds(message_data, {
                template: "",
                title: "Message Deleted",
            });
            await user.send({
                content:
                    `Your message in <#${this.wheatley.channels.memes}> was deleted because it didn't contain ` +
                    `any images, videos, or media embeds. This channel is for sharing memes only. For commentary ` +
                    `please open a thread.`,
                embeds: quote.embeds,
                files: quote.files,
            });
        } catch (e) {
            // Ignore errors sending DMs (user may have DMs disabled)
            if (!(e instanceof Discord.DiscordAPIError && e.code === 50007)) {
                throw e;
            }
        }
    }

    private schedule_deletion(message: Discord.Message) {
        if (this.pending_deletions.has(message.id)) {
            return;
        }
        const timeout = set_timeout(() => {
            this.pending_deletions.remove(message.id);
            this.delete_message(message).catch(this.wheatley.critical_error.bind(this.wheatley));
        }, GRACE_PERIOD);
        this.pending_deletions.set(message.id, timeout);
    }

    override async on_message_create(message: Discord.Message) {
        if (DISABLED) {
            return;
        }
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (message.channel.id !== this.wheatley.channels.memes) {
            return;
        }
        if (await this.should_skip(message)) {
            return;
        }
        if (!has_media(message)) {
            this.schedule_deletion(message);
        }
    }

    override async on_message_update(
        _old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        if (DISABLED) {
            return;
        }
        if (new_message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (new_message.channel.id !== this.wheatley.channels.memes) {
            return;
        }
        const message = await departialize(new_message);
        if (await this.should_skip(message)) {
            return;
        }
        if (has_media(message)) {
            this.pending_deletions.remove(message.id);
        }
    }
}
