import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { get_tag } from "../utils/discord.js";
import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

/*
 * Forum thread handling:
 * Implements:
 * - !solved / etc
 */

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(msg);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

export default class ForumControl extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder(["solve", "solved", "close"])
                .set_description("Close forum post and mark it as solved")
                .set_handler(this.solve.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder(["unsolve", "unsolved", "open"])
                .set_description("Re-open forum post")
                .set_handler(this.unsolve.bind(this)),
        );
    }

    async get_owner(thread: Discord.ThreadChannel) {
        if (unwrap(thread.parent) instanceof Discord.ForumChannel) {
            return thread.ownerId!; /*TODO*/
        } else {
            return thread.type == Discord.ChannelType.PrivateThread
                ? thread.ownerId! /*TODO*/
                : (await thread.fetchStarterMessage())! /*TODO*/.author.id;
        }
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: TextBasedCommand, action: string) {
        const channel = await request.get_channel();
        if (channel.isThread()) {
            const thread = channel;
            const owner_id = await this.get_owner(thread);
            if (owner_id == request.user.id || this.wheatley.is_authorized_mod(request.user.id)) {
                return true;
            } else {
                await request.reply({
                    content: `You can only ${action} threads you own`,
                    should_text_reply: true,
                });
                return false;
            }
        } else {
            await request.reply({
                content: `You can only ${action} threads`,
                should_text_reply: true,
            });
            return false;
        }
    }

    // TODO: more to dedupe

    async solve(command: TextBasedCommand) {
        if (await this.try_to_control_thread(command, command.name.startsWith("!solve") ? "solve" : "close")) {
            const channel = await command.get_channel();
            if (!channel.isThread() || !(channel.parent instanceof Discord.ForumChannel)) {
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(colors.red)
                            .setDescription("Command must be used on a forum help thread."),
                    ],
                });
                return;
            }
            const thread = channel;
            const forum = channel.parent;
            const solved_tag = get_tag(forum, "Solved").id;
            const open_tag = get_tag(forum, "Open").id;
            const stale_tag = get_tag(forum, "Stale").id;
            if (this.wheatley.is_forum_help_thread(thread)) {
                // TODO
                if (!thread.appliedTags.some(tag => tag == solved_tag)) {
                    M.log("Marking thread as solved", thread.id, thread.name);
                    await command.reply({
                        embeds: [
                            create_embed(
                                undefined,
                                colors.wheatley,
                                "Thank you and let us know if you have any more questions!\n\n" +
                                    "This thread is now set to auto-hide after an hour of inactivity",
                            ),
                        ],
                    });
                    await thread.setAppliedTags(
                        [solved_tag].concat(thread.appliedTags.filter(tag => ![open_tag, stale_tag].includes(tag))),
                    );
                    //await thread.setArchived(true);
                    await thread.setAutoArchiveDuration(Discord.ThreadAutoArchiveDuration.OneHour, "Solved");
                } else {
                    await command.reply({
                        content: "Message is already solved",
                        should_text_reply: true,
                    });
                }
            } else {
                await command.reply({
                    content: "You can't use that here",
                    should_text_reply: true,
                });
            }
        }
    }

    async unsolve(command: TextBasedCommand) {
        if (await this.try_to_control_thread(command, command.name.startsWith("!unsolve") ? "unsolve" : "open")) {
            const channel = await command.get_channel();
            if (!channel.isThread() || !(channel.parent instanceof Discord.ForumChannel)) {
                await command.reply({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(colors.red)
                            .setDescription("Command must be used on a forum help thread."),
                    ],
                });
                return;
            }
            const thread = channel;
            const forum = channel.parent;
            const solved_tag = get_tag(forum, "Solved").id;
            const open_tag = get_tag(forum, "Open").id;
            if (this.wheatley.is_forum_help_thread(thread)) {
                // TODO
                if (thread.appliedTags.some(tag => tag == solved_tag)) {
                    M.log("Unsolving thread", thread.id, thread.name);
                    await command.react("✅");
                    await thread.setAppliedTags([open_tag].concat(thread.appliedTags.filter(tag => tag != solved_tag)));
                }
            } else {
                await command.reply({
                    content: "You can't use that here",
                    should_text_reply: true,
                });
            }
        }
    }
}
