import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { unwrap } from "../../../utils/misc.js";
import { get_tag } from "../../../utils/discord.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { colors } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { BotButton, ButtonInteractionBuilder } from "../../../command-abstractions/button.js";

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

const SOLVED_MESSAGE =
    "Thank you and let us know if you have any more questions!\n\n" +
    "This thread is now set to auto-hide after an hour of inactivity";

export default class ForumControl extends BotComponent {
    private mark_solved_button!: BotButton<[string]>;
    private reopen_button!: BotButton<[string]>;

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder(["solve", "solved", "close"], EarlyReplyMode.visible)
                .set_category("Thread Control")
                .set_description("Close forum post and mark it as solved")
                .set_handler(this.solve.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder(["unsolve", "unsolved", "open"], EarlyReplyMode.visible)
                .set_category("Thread Control")
                .set_description("Re-open forum post")
                .set_handler(this.unsolve.bind(this)),
        );

        this.mark_solved_button = commands.add(
            new ButtonInteractionBuilder("mark_solved")
                .add_string_metadata()
                .set_handler(this.handle_mark_solved_button.bind(this)),
        );

        this.reopen_button = commands.add(
            new ButtonInteractionBuilder("reopen_thread")
                .add_string_metadata()
                .set_handler(this.handle_reopen_button.bind(this)),
        );
    }

    // returns whether the thread can be controlled
    // or sends an error message
    async try_to_control_thread(request: TextBasedCommand, action: string) {
        const channel = await request.get_channel();
        if (channel.isThread()) {
            const thread = channel;
            if (await this.utilities.can_user_control_thread(request.user, thread)) {
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

    async check_help_channel(command: TextBasedCommand, thread: Discord.ThreadChannel) {
        if (this.wheatley.is_forum_help_thread(thread)) {
            return true;
        } else {
            await command.reply("Cannot use outside a help channel");
            return false;
        }
    }

    async validate_thread_control(
        user: Discord.User,
        thread_id: string,
        interaction: Discord.ButtonInteraction,
    ): Promise<Discord.ThreadChannel | null> {
        const thread = await this.wheatley.client.channels.fetch(thread_id);
        if (!thread || !thread.isThread()) {
            await interaction.reply({
                content: "This thread no longer exists",
                ephemeral: true,
            });
            return null;
        }
        if (!(thread.parent instanceof Discord.ForumChannel)) {
            await interaction.reply({
                content: "This is not a forum thread",
                ephemeral: true,
            });
            return null;
        }
        if (!(await this.utilities.can_user_control_thread(user, thread))) {
            await interaction.reply({ content: "You can only control threads you own", ephemeral: true });
            return null;
        }
        if (!this.wheatley.is_forum_help_thread(thread)) {
            await interaction.reply({ content: "Cannot use outside a help channel", ephemeral: true });
            return null;
        }
        return thread;
    }

    async mark_thread_solved(thread: Discord.ThreadChannel) {
        assert(thread.parent instanceof Discord.ForumChannel);
        const forum = thread.parent;
        const solved_tag = get_tag(forum, "Solved").id;
        const open_tag = get_tag(forum, "Open").id;
        const stale_tag = get_tag(forum, "Stale").id;
        await thread.setAppliedTags(
            [solved_tag].concat(thread.appliedTags.filter(tag => ![open_tag, stale_tag].includes(tag))),
        );
        await thread.setAutoArchiveDuration(Discord.ThreadAutoArchiveDuration.OneHour, "Solved");
        await this.update_control_message(thread.id, true);
    }

    async mark_thread_open(thread: Discord.ThreadChannel) {
        assert(thread.parent instanceof Discord.ForumChannel);
        const forum = thread.parent;
        const solved_tag = get_tag(forum, "Solved").id;
        const open_tag = get_tag(forum, "Open").id;
        await thread.setAppliedTags([open_tag].concat(thread.appliedTags.filter(tag => tag !== solved_tag)));
        await this.update_control_message(thread.id, false);
    }

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
            if (!(await this.check_help_channel(command, channel))) {
                return;
            }
            const thread = channel;
            assert(thread.parent instanceof Discord.ForumChannel);
            const forum = thread.parent;
            const solved_tag = get_tag(forum, "Solved").id;
            if (!thread.appliedTags.some(tag => tag === solved_tag)) {
                M.log("Marking thread as solved", thread.id, thread.name);
                await command.reply({
                    embeds: [create_embed(undefined, colors.wheatley, SOLVED_MESSAGE)],
                });
                await this.mark_thread_solved(thread);
            } else {
                await command.reply({
                    content: "Thread is already solved",
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
            if (!(await this.check_help_channel(command, channel))) {
                return;
            }
            const thread = channel;
            assert(thread.parent instanceof Discord.ForumChannel);
            const forum = thread.parent;
            const solved_tag = get_tag(forum, "Solved").id;
            if (thread.appliedTags.some(tag => tag === solved_tag)) {
                M.log("Unsolving thread", thread.id, thread.name);
                await command.react("✅");
                await this.mark_thread_open(thread);
            } else {
                await command.reply({
                    content: "Thread isn't solved",
                    should_text_reply: true,
                });
            }
        }
    }

    async handle_mark_solved_button(interaction: Discord.ButtonInteraction, thread_id: string) {
        const thread = await this.validate_thread_control(interaction.user, thread_id, interaction);
        if (!thread) {
            return;
        }
        assert(thread.parent instanceof Discord.ForumChannel);
        const forum = thread.parent;
        const solved_tag = get_tag(forum, "Solved").id;
        if (!thread.appliedTags.some(tag => tag === solved_tag)) {
            M.log("Marking thread as solved via button", thread.id, thread.name);
            await interaction.reply({
                embeds: [create_embed(undefined, colors.wheatley, SOLVED_MESSAGE)],
            });
            await this.mark_thread_solved(thread);
        } else {
            await interaction.reply({
                content: "Thread is already solved",
                ephemeral: true,
            });
        }
    }

    async handle_reopen_button(interaction: Discord.ButtonInteraction, thread_id: string) {
        const thread = await this.validate_thread_control(interaction.user, thread_id, interaction);
        if (!thread) {
            return;
        }
        assert(thread.parent instanceof Discord.ForumChannel);
        const forum = thread.parent;
        const solved_tag = get_tag(forum, "Solved").id;
        if (thread.appliedTags.some(tag => tag === solved_tag)) {
            M.log("Reopening thread via button", thread.id, thread.name);
            await interaction.reply({
                content: "Thread reopened",
                ephemeral: true,
            });
            await this.mark_thread_open(thread);
        } else {
            await interaction.reply({
                content: "Thread is already open",
                ephemeral: true,
            });
        }
    }

    async update_control_message(thread_id: string, is_solved: boolean) {
        const thread = await this.wheatley.client.channels.fetch(thread_id);
        if (!thread || !thread.isThread()) {
            return;
        }
        try {
            const messages = await thread.messages.fetch({ limit: 20 });
            const control_message = messages.find(
                msg => msg.author.id === this.wheatley.user.id && msg.embeds.length > 0,
            );
            if (control_message) {
                const components = this.create_thread_control_components(thread_id, is_solved);
                await control_message.edit({ components });
            }
        } catch (error) {
            M.debug("Failed to update control message:", error);
        }
    }

    create_thread_control_components(
        thread_id: string,
        is_solved: boolean,
    ): Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>[] {
        if (is_solved) {
            return [
                new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    this.reopen_button
                        .create_button(thread_id)
                        .setLabel("Reopen")
                        .setStyle(Discord.ButtonStyle.Secondary)
                        .setEmoji("🔄"),
                ),
            ];
        } else {
            return [
                new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    this.mark_solved_button
                        .create_button(thread_id)
                        .setLabel("Mark as Solved")
                        .setStyle(Discord.ButtonStyle.Success)
                        .setEmoji("✅"),
                ),
            ];
        }
    }
}
