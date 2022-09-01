import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M, SelfClearingMap } from "../utils";
import { colors, is_authorized_admin, MINUTE, rules_channel_id, skill_role_ids, TCCPP_ID, thread_based_help_channel_ids, wheatley_id } from "../common";

let client: Discord.Client;

let TCCPP : Discord.Guild;

// tracks whether channels are forum channels or not
// TODO: This is temporary until discordjs supports forums
const forum_channels = new Set([
    "1013107104678162544", // cpp-help
    "1013104018739974194", // c-help
    "1014328785685979136", // projects
]);
const forum_help_channels = new Set([
    "1013107104678162544", // cpp-help
    "1013104018739974194", // c-help
]);

function is_forum_thread(thread: Discord.ThreadChannel) {
    return thread.parentId && forum_channels.has(thread.parentId);
}

async function get_owner(thread: Discord.ThreadChannel) {
    if(is_forum_thread(thread)) {
        return thread.ownerId!/*TODO*/
    } else {
        return thread.type == "GUILD_PRIVATE_THREAD" ? thread.ownerId!/*TODO*/
            : (await thread.fetchStarterMessage())!/*TODO*/.author.id;
    }
}

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.MessageEmbed()
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

async function on_message(request: Discord.Message) {
    try {
        if(request.author.bot) return; // Ignore bots
        if(request.content.match(/^!rename\s+(.+)/gm)) {
            M.debug("received rename command", request.content, request.author.username);
            if(await try_to_control_thread(request, "rename")) {
                const channel = request.channel ?? await TCCPP.channels.fetch(request.channelId); /* TODO: Temporary hack due to forums, for some reason with forums .channel can be undefined EDIT: Wait never mind I might have confused something but leaving this anyway */
                assert(channel.isThread());
                const thread = channel;
                const owner_id = await get_owner(thread);
                const name = request.content.substring("!rename".length).trim();
                const old_name = thread.name;
                M.log(`Thread ${thread.id} being renamed to "${name}"`);
                if(name.length > 100 - "[SOLVED] ".length) {
                    await request.reply({
                        content: `Thread names must be ${100 - "[SOLVED] ".length} characters or shorter`
                    });
                    return;
                }
                await thread.setName(name);
                await request.delete();
                //await request.reply({
                //    embeds: [create_embed(undefined, colors.green, "Success :+1:")]
                //});
                //await request.reply({
                //    content: "Success :+1:"
                //});
                // fetch first message
                let messages = await thread.messages.fetch({
                    after: thread.id,
                    limit: 2 // thread starter message, then wheatley's message
                });
                for(const [_, message] of messages) {
                    if(message.type == "DEFAULT" && message.author.id == wheatley_id) {
                        message.delete();
                    }
                }
                // extra logic for thread-based help channels
                if(thread.parentId && thread_based_help_channel_ids.has(thread.parentId)) {
                    // Only bother people without skill roles with this reminder
                    const owner = await thread.guild.members.fetch(owner_id);
                    if(old_name == `Help ${owner?.displayName}`) { // only if not already renamed
                        if(owner.roles.cache.filter(r => skill_role_ids.has(r.id)).size == 0) {
                            thread.send(`<@${owner_id}> Remember: Try to provide as much relevant info as possible so people can help. Use \`!howto ask\` for tips on how to ask a programming question.`);
                        }
                    }
                }
            }
        }
        if(request.content == "!archive") {
            if(await try_to_control_thread(request, "archive")) {
                assert(request.channel.isThread());
                if(request.channel.parentId == rules_channel_id
                && request.channel.type == "GUILD_PRIVATE_THREAD") {
                    await request.channel.setArchived();
                } else {
                    request.reply("You can't use that here");
                }
            }
        }
        if(request.content == "!solved" || request.content == "!close") {
            if(await try_to_control_thread(request, request.content == "!solved" ? "solve" : "close")) {
                assert(request.channel.isThread());
                const thread = request.channel;
                if(thread.parentId && (thread_based_help_channel_ids.has(thread.parentId) || forum_help_channels.has(thread.parentId))) {
                    if(!thread.name.startsWith("[SOLVED]")) {
                        await request.react("👍");
                        await thread.setName(`[SOLVED] ${thread.name}`);
                    }
                } else {
                    request.reply("You can't use that here");
                }
            }
        }
        if(request.content == "!unsolve" || request.content == "!unsolved") {
            if(await try_to_control_thread(request, "unsolve")) {
                assert(request.channel.isThread());
                const thread = request.channel;
                if(thread.parentId && (thread_based_help_channel_ids.has(thread.parentId) || forum_help_channels.has(thread.parentId))) {
                    if(thread.name.startsWith("[SOLVED]")) {
                        await request.react("👍");
                        await thread.setName(thread.name.substring("[SOLVED]".length).trim());
                    }
                } else {
                    request.reply("You can't use that here");
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
    if(!is_forum_thread(thread)) {
        const owner_id = await get_owner(thread);
        await thread.send({
            content: `<@${owner_id}>`,
            embeds: [create_embed(undefined, colors.red, `Thread created, you are the owner. You can rename the thread with \`!rename <name>\``)]
        });
    }
}

async function on_ready() {
    try {
        client.on("messageCreate", on_message);
        client.on("threadCreate", on_thread_create);
        TCCPP = await client.guilds.fetch(TCCPP_ID);
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_thread_control(_client: Discord.Client) {
    try {
        client = _client;
        client.on("ready", on_ready);
    } catch(e) {
        critical_error(e);
    }
}
