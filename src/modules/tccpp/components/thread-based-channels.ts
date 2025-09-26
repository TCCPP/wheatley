import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";

/*
 * Thread-based channel logic (non-forum)
 * Handles:
 * - Thread auto-creation
 * - Thread creation info message
 */

async function get_owner(thread: Discord.ThreadChannel) {
    if (unwrap(thread.parent) instanceof Discord.ForumChannel) {
        return thread.ownerId;
    } else {
        return thread.type == Discord.ChannelType.PrivateThread
            ? thread.ownerId
            : (await thread.fetchStarterMessage())! /*TODO*/.author.id;
    }
}

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(msg);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

export default class ThreadBasedChannels extends BotComponent {
    thread_based_channel_ids!: Set<string>;

    override async on_ready() {
        this.thread_based_channel_ids = new Set([
            this.wheatley.channels.server_suggestions,
            this.wheatley.channels.showcase,
            this.wheatley.channels.today_i_learned,
        ]);
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots and thread create messages
        if (message.author.bot || message.type == Discord.MessageType.ThreadCreated) {
            return;
        }
        if (this.thread_based_channel_ids.has(message.channel.id)) {
            const s = message.member?.displayName.trim().endsWith("s") ? "" : "s"; // rudimentary
            const thread = await message.startThread({
                name: `${message.member?.displayName}'${s} post`,
            });
            await thread.send({
                content:
                    `<@${message.author.id}> This thread is for your post, use \`!rename <brief description>\` to ` +
                    "set the thread's name.",
                allowedMentions: { parse: [] },
            });
            await thread.members.add(message.author);
            await thread.leave();
        }
    }

    override async on_thread_create(thread: Discord.ThreadChannel) {
        if (thread.ownerId == this.wheatley.user.id) {
            // wheatley threads are either modlogs or thread help threads
            return;
        }
        if (!(unwrap(thread.parent) instanceof Discord.ForumChannel)) {
            const owner_id = await get_owner(thread);
            await thread.send({
                content: `<@${owner_id}>`,
                embeds: [
                    create_embed(
                        undefined,
                        colors.red,
                        "Thread created, you are the owner. You can rename the thread with `!rename <name>`",
                    ),
                ],
            });
        }
    }

    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (message.channelId === this.wheatley.channels.today_i_learned) {
            if (message.hasThread) {
                await unwrap(message.thread).send(
                    "This today I learned post was removed. If it was removed by a moderator it was likely due to it " +
                        "being off topic. Note that the channel is about more than just what you learned today, it's " +
                        "for sharing things that might be useful to others as well.",
                );
            }
        }
    }
}
