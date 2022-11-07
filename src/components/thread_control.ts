import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { denullify, M } from "../utils";
import { is_authorized_admin, rules_channel_id, wheatley_id } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

/*
 * Thread control for threads in thread-based (non-forum) channels
 * Really just:
 * - !rename
 * - !archive
 */

export class ThreadControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    async get_owner(thread: Discord.ThreadChannel) {
        if(denullify(thread.parent) instanceof Discord.ForumChannel) {
            return thread.ownerId!;/*TODO*/
        } else {
            return thread.type == Discord.ChannelType.PrivateThread ? thread.ownerId!/*TODO*/
                : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
        }
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: Discord.Message, action: string) {
        if(request.channel.isThread()) {
            const thread = request.channel;
            const owner_id = await this.get_owner(thread);
            if(owner_id == request.author.id || is_authorized_admin(request.author.id)) {
                return true;
            } else {
                await request.reply({
                    content: `You can only ${action} threads you own`
                });
                return false;
            }
        } else {
            await request.reply({
                content: `You can only ${action} threads`
            });
            return false;
        }
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.content.match(/^!rename\s+(.+)/gm)) {
            M.log("Received rename command", message.content, message.author.username, message.channel.url);
            if(await this.try_to_control_thread(message, "rename")) {
                const channel = message.channel;
                assert(channel.isThread());
                const thread = channel;
                const name = message.content.substring("!rename".length).trim();
                M.log(`Thread ${thread.id} being renamed to "${name}"`);
                if(name.length > 100) { // TODO
                    await message.reply({
                        content: "Thread names must be 100 characters or shorter"
                    });
                    return;
                }
                await thread.setName(name);
                await message.delete();
                // fetch first message
                const messages = await thread.messages.fetch({
                    after: thread.id,
                    limit: 2 // thread starter message, then wheatley's message
                });
                for(const [ _, message ] of messages) {
                    if(message.type == Discord.MessageType.Default && message.author.id == wheatley_id) {
                        message.delete();
                    }
                }
            }
        }
        if(message.content == "!archive") {
            M.debug("Received archive command", message.content, message.author.username, message.channel.url);
            if(await this.try_to_control_thread(message, "archive")) {
                assert(message.channel.isThread());
                if(message.channel.parentId == rules_channel_id
                && message.channel.type == Discord.ChannelType.PrivateThread) {
                    await message.channel.setArchived();
                } else {
                    message.reply("You can't use that here");
                }
            }
        }
    }
}
