import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap, M } from "../utils.js";
import { is_authorized_admin, rules_channel_id } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommand, TextBasedCommandBuilder } from "../command.js";

/*
 * Thread control for threads in thread-based (non-forum) channels
 * Really just:
 * - !rename
 * - !archive
 */

export class ThreadControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("archive")
                .set_description("Archives the thread")
                .set_handler(this.archive.bind(this))
        );

        this.add_command(
            new TextBasedCommandBuilder("rename")
                .set_description("Rename the thread")
                .add_string_option({
                    title: "name",
                    description: "Name",
                    required: true
                })
                .set_handler(this.rename.bind(this))
        );
    }

    async get_owner(thread: Discord.ThreadChannel) {
        if(unwrap(thread.parent) instanceof Discord.ForumChannel) {
            return thread.ownerId!;/*TODO*/
        } else {
            return thread.type == Discord.ChannelType.PrivateThread ? thread.ownerId!/*TODO*/
                : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
        }
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: TextBasedCommand, action: string) {
        const channel = await request.get_channel();
        if(channel.isThread()) {
            const thread = channel;
            if(thread.parentId == rules_channel_id) {
                return true; // just let the user do it, should be fine
            }
            const owner_id = await this.get_owner(thread);
            if(owner_id == request.user.id || is_authorized_admin(request.user.id)) {
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

    async archive(command: TextBasedCommand) {
        M.debug("Received archive command", command.user.username, command.get_or_forge_url());
        if(await this.try_to_control_thread(command, "archive")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            if(channel.parentId == rules_channel_id
            && channel.type == Discord.ChannelType.PrivateThread) {
                await channel.setArchived();
            } else {
                await command.reply("You can't use that here", true);
            }
        }
    }

    async rename(command: TextBasedCommand, name: string) {
        M.log("Received rename command", command.user.username, command.get_or_forge_url());
        if(await this.try_to_control_thread(command, "rename")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            const thread = channel;
            name = name.trim();
            M.log(`Thread ${thread.id} being renamed to "${name}"`);
            if(name.length > 100) { // TODO
                await command.reply("Thread names must be 100 characters or shorter", true);
                return;
            }
            await thread.setName(name);
            if(command.is_slash()) {
                command.reply("✅", true);
            } else {
                await command.delete_invocation();
            }
            // fetch first message
            const messages = await thread.messages.fetch({
                after: thread.id,
                limit: 2 // thread starter message, then wheatley's message
            });
            for(const [ _, message ] of messages) {
                if(message.type == Discord.MessageType.Default && message.author.id == this.wheatley.id) {
                    message.delete();
                }
            }
        }
    }
}
