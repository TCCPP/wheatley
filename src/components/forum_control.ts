import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { denullify, get_tag, M } from "../utils";
import { colors, forum_help_channels, is_authorized_admin } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";
import { Command, CommandBuilder } from "../command";

/*
 * Forum thread handling:
 * Implements:
 * - !solved / etc
 */

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

export class ForumControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new CommandBuilder([ "solve", "solved", "close" ])
                .set_description("Close forum post and mark it as solved")
                .set_handler(this.solve.bind(this))
        );

        this.add_command(
            new CommandBuilder([ "unsolve", "unsolved", "open" ])
                .set_description("Re-open forum post")
                .set_handler(this.unsolve.bind(this))
        );
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
    async try_to_control_thread(request: Command, action: string) {
        const channel = await request.get_channel();
        if(channel.isThread()) {
            const thread = channel;
            const owner_id = await this.get_owner(thread);
            if(owner_id == request.user.id || is_authorized_admin(request.user.id)) {
                return true;
            } else {
                await request.reply({
                    content: `You can only ${action} threads you own`,
                    should_text_reply: true
                });
                return false;
            }
        } else {
            await request.reply({
                content: `You can only ${action} threads`,
                should_text_reply: true
            });
            return false;
        }
    }

    // TODO: more to dedupe

    async solve(command: Command) {
        if(await this.try_to_control_thread(command, command.name.startsWith("!solve") ? "solve" : "close")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            const thread = channel;
            const forum = thread.parent;
            assert(forum instanceof Discord.ForumChannel);
            const solved_tag = get_tag(forum, "Solved").id;
            const open_tag = get_tag(forum, "Open").id;
            if(thread.parentId && forum_help_channels.has(thread.parentId)) { // TODO
                if(!thread.appliedTags.some(tag => tag == solved_tag)) {
                    M.log("Marking thread as solved", thread.id, thread.name);
                    await command.reply({
                        embeds: [
                            create_embed(undefined, colors.color, "Thank you and let us know if you have any more "
                                + "questions!")
                        ]
                    });
                    await thread.setAppliedTags(
                        [solved_tag].concat(thread.appliedTags.filter(tag => tag != open_tag))
                    );
                    await thread.setArchived(true);
                } else {
                    await command.reply({
                        content: "Message is already solved",
                        should_text_reply: true
                    });
                }
            } else {
                await command.reply({
                    content: "You can't use that here",
                    should_text_reply: true
                });
            }
        }
    }

    async unsolve(command: Command) {
        if(await this.try_to_control_thread(command, command.name.startsWith("!unsolve") ? "unsolve" : "open")) {
            const channel = await command.get_channel();
            assert(channel.isThread());
            const thread = channel;
            const forum = thread.parent;
            assert(forum instanceof Discord.ForumChannel);
            const solved_tag = get_tag(forum, "Solved").id;
            const open_tag = get_tag(forum, "Open").id;
            if(thread.parentId && forum_help_channels.has(thread.parentId)) { // TODO
                if(thread.appliedTags.some(tag => tag == solved_tag)) {
                    M.log("Unsolving thread", thread.id, thread.name);
                    await command.react("✅");
                    await thread.setAppliedTags(
                        [open_tag].concat(thread.appliedTags.filter(tag => tag != solved_tag))
                    );
                }
            } else {
                await command.reply({
                    content: "You can't use that here",
                    should_text_reply: true
                });
            }
        }
    }
}
