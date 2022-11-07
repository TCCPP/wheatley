import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { denullify, get_tag, M } from "../utils";
import { colors, forum_help_channels, is_authorized_admin } from "../common";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

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
                const reply = await request.reply({
                    content: `You can only ${action} threads you own`
                });
                this.wheatley.deletable.make_message_deletable(request, reply);
                return false;
            }
        } else {
            const reply = await request.reply({
                content: `You can only ${action} threads`
            });
            this.wheatley.deletable.make_message_deletable(request, reply);
            return false;
        }
    }

    override async on_message_create(message: Discord.Message) {
        if(message.author.bot) return; // Ignore bots
        if(message.content == "!solve" || message.content == "!solved" || message.content == "!close") {
            if(await this.try_to_control_thread(message, message.content.startsWith("!solve") ? "solve" : "close")) {
                assert(message.channel.isThread());
                const thread = message.channel;
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const solved_tag = get_tag(forum, "Solved").id;
                const open_tag = get_tag(forum, "Open").id;
                if(thread.parentId && forum_help_channels.has(thread.parentId)) { // TODO
                    if(!thread.appliedTags.some(tag => tag == solved_tag)) {
                        M.log("Marking thread as solved", thread.id, thread.name);
                        //await request.react("👍");
                        const reply = await thread.send({
                            embeds: [
                                create_embed(undefined, colors.color, "Thank you and let us know if you have any more "
                                    + "questions!")
                            ]
                        });
                        this.wheatley.deletable.make_message_deletable(message, reply);
                        await thread.setAppliedTags(
                            [solved_tag].concat(thread.appliedTags.filter(tag => tag != open_tag))
                        );
                        await thread.setArchived(true);
                    } else {
                        const reply = await message.reply("Message is already solved");
                        this.wheatley.deletable.make_message_deletable(message, reply);
                    }
                } else {
                    const reply = await message.reply("You can't use that here");
                    this.wheatley.deletable.make_message_deletable(message, reply);
                }
            }
        }
        if(message.content == "!unsolve" || message.content == "!unsolved" || message.content == "!open") {
            if(await this.try_to_control_thread(message, message.content.startsWith("!unsolve") ? "unsolve" : "open")) {
                assert(message.channel.isThread());
                const thread = message.channel;
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const solved_tag = get_tag(forum, "Solved").id;
                const open_tag = get_tag(forum, "Open").id;
                if(thread.parentId && forum_help_channels.has(thread.parentId)) { // TODO
                    if(thread.appliedTags.some(tag => tag == solved_tag)) {
                        M.log("Unsolving thread", thread.id, thread.name);
                        await message.react("👍");
                        await thread.setAppliedTags(
                            [open_tag].concat(thread.appliedTags.filter(tag => tag != solved_tag))
                        );
                    }
                } else {
                    const reply = await message.reply("You can't use that here");
                    this.wheatley.deletable.make_message_deletable(message, reply);
                }
            }
        }
    }
}
