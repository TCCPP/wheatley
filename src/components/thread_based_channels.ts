import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { denullify } from "../utils";
import { colors, thread_based_channel_ids, wheatley_id } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

/*
 * Thread-based channel logic (non-forum)
 * Handles:
 * - Thread auto-creation
 * - Thread creation info message
 */

async function get_owner(thread: Discord.ThreadChannel) {
    if(denullify(thread.parent) instanceof Discord.ForumChannel) {
        return thread.ownerId!;/*TODO*/
    } else {
        return thread.type == Discord.ChannelType.PrivateThread ? thread.ownerId!/*TODO*/
            : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
    }
}

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

export class ThreadBasedChannels extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.type == Discord.MessageType.ThreadCreated) return; // ignore message create messages
        if(thread_based_channel_ids.has(message.channel.id)) {
            const s = message.member?.displayName.trim().endsWith("s") ? "" : "s"; // rudimentary
            const thread = await message.startThread({
                name: `${message.member?.displayName}'${s} post`
            });
            await thread.send({
                content: `<@${message.author.id}> This thread is for your post, use \`!rename <brief description>\` to `
                    + "set the thread's name.",
                allowedMentions: { parse: [] }
            });
            await thread.members.add(message.author);
            await thread.leave();
        }
    }

    override async on_thread_create(thread: Discord.ThreadChannel) {
        if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
            return;
        }
        if(!(denullify(thread.parent) instanceof Discord.ForumChannel)) {
            const owner_id = await get_owner(thread);
            await thread.send({
                content: `<@${owner_id}>`,
                embeds: [
                    create_embed(undefined, colors.red,
                                 "Thread created, you are the owner. You can rename the thread with `!rename <name>`")
                ]
            });
        }
    }
}
