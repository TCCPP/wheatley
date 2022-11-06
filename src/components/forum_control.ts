import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, denullify, get_tag, M } from "../utils";
import { colors, forum_help_channels, is_authorized_admin, wheatley_id } from "../common";
import { make_message_deletable } from "./deletable";

let client: Discord.Client;

/*
 * Forum thread handling:
 * Implements:
 * - !solved / etc
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

// returns whether the thread can be controlled
// or sends an error message
async function try_to_control_thread(request: Discord.Message, action: string) {
    if(request.channel.isThread()) {
        const thread = request.channel;
        const owner_id = await get_owner(thread);
        if(owner_id == request.author.id || is_authorized_admin(request.author.id)) {
            return true;
        } else {
            const reply = await request.reply({
                content: `You can only ${action} threads you own`
            });
            make_message_deletable(request, reply);
            return false;
        }
    } else {
        const reply = await request.reply({
            content: `You can only ${action} threads`
        });
        make_message_deletable(request, reply);
        return false;
    }
}

async function on_message(request: Discord.Message) {
    try {
        if(request.author.bot) return; // Ignore bots
        if(request.content == "!solve" || request.content == "!solved" || request.content == "!close") {
            if(await try_to_control_thread(request, request.content.startsWith("!solve") ? "solve" : "close")) {
                assert(request.channel.isThread());
                const thread = request.channel;
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
                        make_message_deletable(request, reply);
                        await thread.setAppliedTags(
                            [solved_tag].concat(thread.appliedTags.filter(tag => tag != open_tag))
                        );
                        await thread.setArchived(true);
                    } else {
                        const reply = await request.reply("Message is already solved");
                        make_message_deletable(request, reply);
                    }
                } else {
                    const reply = await request.reply("You can't use that here");
                    make_message_deletable(request, reply);
                }
            }
        }
        if(request.content == "!unsolve" || request.content == "!unsolved" || request.content == "!open") {
            if(await try_to_control_thread(request, request.content.startsWith("!unsolve") ? "unsolve" : "open")) {
                assert(request.channel.isThread());
                const thread = request.channel;
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const solved_tag = get_tag(forum, "Solved").id;
                const open_tag = get_tag(forum, "Open").id;
                if(thread.parentId && forum_help_channels.has(thread.parentId)) { // TODO
                    if(thread.appliedTags.some(tag => tag == solved_tag)) {
                        M.log("Unsolving thread", thread.id, thread.name);
                        await request.react("👍");
                        await thread.setAppliedTags(
                            [open_tag].concat(thread.appliedTags.filter(tag => tag != solved_tag))
                        );
                    }
                } else {
                    const reply = await request.reply("You can't use that here");
                    make_message_deletable(request, reply);
                }
            }
        }
    } catch(e) {
        critical_error(e);
    }
}

async function on_thread_create(thread: Discord.ThreadChannel) {
    //if(thread.parentId == rules_channel_id) {
    if(thread.ownerId == wheatley_id) { // wheatley threads are either modlogs or thread help threads
        return;
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_forum_control(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
