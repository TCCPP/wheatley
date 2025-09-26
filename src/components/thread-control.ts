import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

export default class ThreadControl extends BotComponent {
    private rules: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.rules = await this.utilities.get_channel(this.wheatley.channels.rules);
        commands.add(
            new TextBasedCommandBuilder("archive", EarlyReplyMode.ephemeral)
                .set_description("Archives the thread")
                .set_handler(this.archive.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("rename", EarlyReplyMode.ephemeral)
                .set_description("Rename the thread")
                .add_string_option({
                    title: "name",
                    description: "Name",
                    required: true,
                })
                .set_handler(this.rename.bind(this)),
        );
    }

    async get_owner(thread: Discord.ThreadChannel) {
        if (unwrap(thread.parent) instanceof Discord.ForumChannel) {
            return thread.ownerId;
        } else {
            return thread.type == Discord.ChannelType.PrivateThread
                ? thread.ownerId
                : (await thread.fetchStarterMessage())! /*TODO*/.author.id;
        }
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: TextBasedCommand, action: string) {
        const channel = await request.get_channel();
        if (channel.isThread()) {
            const thread = channel;
            if (thread.parentId == this.rules.id) {
                return true; // just let the user do it, should be fine
            }
            const owner_id = await this.get_owner(thread);
            if (owner_id == request.user.id || this.wheatley.is_authorized_mod(request.user.id)) {
                return true;
            } else {
                await request.reply({
                    content: `You can only ${action} threads you own`,
                });
                return false;
            }
        } else {
            await request.reply({
                content: `You can only ${action} threads`,
            });
            return false;
        }
    }

    async archive(command: TextBasedCommand) {
        M.debug("Received archive command", command.user.username, command.get_or_forge_url());
        if (await this.try_to_control_thread(command, "archive")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            if (
                channel.parentId == this.rules.id &&
                channel.type == Discord.ChannelType.PrivateThread
            ) {
                await command.reply("Archiving", true);
                await channel.setArchived();
            } else {
                await command.reply("You can't use that here", true);
            }
        }
    }

    async rename(command: TextBasedCommand, name: string) {
        if (await this.try_to_control_thread(command, "rename")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            const thread = channel;
            name = name.trim();
            M.log(`Thread ${thread.id} being renamed to "${name}"`);
            if (name.length > 100) {
                // TODO
                await command.reply("Thread names must be 100 characters or shorter", true);
                return;
            }
            await thread.setName(name);
            if (command.is_slash()) {
                await command.reply("✅", true);
            } else {
                await command.delete_invocation();
            }
            // fetch first message
            const messages = await thread.messages.fetch({
                after: thread.id,
                limit: 2, // thread starter message, then wheatley's message
            });
            for (const [_, message] of messages) {
                if (message.type == Discord.MessageType.Default && message.author.id == this.wheatley.user.id) {
                    await message.delete();
                }
            }
        }
    }
}
