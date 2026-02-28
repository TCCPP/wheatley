import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { BotButton, ButtonInteractionBuilder } from "../../../command-abstractions/button.js";
import { ensure_index } from "../../../infra/database-interface.js";

export type notification_thread_entry = {
    user_id: string;
    channel_id: string;
    thread_id: string;
};

export default class NotificationThreads extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        notification_threads: notification_thread_entry;
    }>();

    private archive_button!: BotButton<[string]>;

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.notification_threads, {
            user_id: 1,
            channel_id: 1,
        });
        await ensure_index(this.wheatley, this.database.notification_threads, {
            thread_id: 1,
        });

        this.archive_button = commands.add(
            new ButtonInteractionBuilder("archive_notification_thread")
                .add_user_id_metadata()
                .set_handler(this.handle_archive_button.bind(this)),
        );
    }

    private async handle_archive_button(interaction: Discord.ButtonInteraction) {
        const channel = interaction.channel;
        if (!channel || !channel.isThread()) {
            await interaction.reply({
                content: "This button can only be used in a thread",
                ephemeral: true,
            });
            return;
        }
        const entry = await this.database.notification_threads.findOne({
            thread_id: interaction.channelId,
        });
        if (!entry) {
            await interaction.reply({
                content: "Error: No recorded database entry for thread",
                ephemeral: true,
            });
            return;
        }
        if (interaction.user.id !== entry.user_id) {
            await interaction.reply({
                content: "Only the owner of this thread can archive it",
                ephemeral: true,
            });
            return;
        }
        await interaction.reply({
            content: "Archiving",
            ephemeral: true,
        });
        await channel.setArchived(true);
    }

    private add_archive_button_to_message(
        message: Discord.MessageCreateOptions,
        user_id: string,
    ): Discord.MessageCreateOptions {
        const archive_button = this.archive_button
            .create_button(user_id)
            .setLabel("Archive Thread")
            .setStyle(Discord.ButtonStyle.Secondary);
        const action_row = new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(archive_button);
        const existing_components = message.components ?? [];
        return {
            ...message,
            components: [...existing_components, action_row],
        };
    }

    private async get_thread(
        parent_channel: Discord.TextChannel,
        user_id: string,
    ): Promise<Discord.ThreadChannel | null> {
        try {
            const entry = await this.database.notification_threads.findOne({
                user_id,
                channel_id: parent_channel.id,
            });
            if (!entry) {
                return null;
            }
            const thread = await parent_channel.threads.fetch(entry.thread_id);
            if (!thread) {
                return null;
            }
            if (thread.archived) {
                await thread.setArchived(false);
            }
            return thread;
        } catch (error) {
            if (error instanceof Discord.DiscordAPIError && error.code === 10003) {
                // 10003: Unknown Channel - thread was deleted
                return null;
            }
            throw error;
        }
    }

    private async create_new_notification_thread(
        parent_channel: Discord.TextChannel,
        user_id: string,
        thread_name: string,
    ): Promise<Discord.ThreadChannel> {
        const thread = await parent_channel.threads.create({
            type: Discord.ChannelType.PrivateThread,
            invitable: false,
            name: thread_name,
            autoArchiveDuration: Discord.ThreadAutoArchiveDuration.OneWeek,
        });
        await this.database.notification_threads.insertOne({
            user_id,
            channel_id: parent_channel.id,
            thread_id: thread.id,
        });
        return thread;
    }

    private async notify_user_via_dm(user: Discord.User, message: Discord.MessageCreateOptions): Promise<boolean> {
        try {
            await (await user.createDM()).send(message);
            return true;
        } catch (e) {
            // 50007 Cannot send messages to this user
            //  https://docs.discord.com/developers/topics/opcodes-and-status-codes
            // 50278 Cannot send messages to this user
            //  undocumented by discord but appears in https://docs.discord.food/topics/errors
            //  and https://gist.github.com/Dziurwa14/de2498e5ee28d2089f095aa037957cbb
            if (e instanceof Discord.DiscordAPIError && (e.code === 50007 || e.code === 50278)) {
                return false;
            }
            throw e;
        }
    }

    private async notify_user_via_thread(
        parent_channel: Discord.TextChannel,
        user: Discord.User,
        message: Discord.MessageCreateOptions,
        thread_name: string,
    ): Promise<boolean> {
        const member = await this.wheatley.try_fetch_guild_member(user);
        if (!member) {
            return false;
        }
        const thread =
            (await this.get_thread(parent_channel, user.id)) ||
            (await this.create_new_notification_thread(parent_channel, user.id, thread_name));
        const message_with_button = this.add_archive_button_to_message(message, user.id);
        await thread.send(message_with_button);
        try {
            await thread.members.add(member.id);
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 10013) {
                // 10013: Unknown user - can happen if the user blocked the bot
                return false;
            }
            throw e;
        }
        return true;
    }

    public async notify_user_with_thread_fallback(
        parent_channel: Discord.TextChannel,
        user: Discord.User,
        message: Discord.MessageCreateOptions,
        thread_name: string,
    ): Promise<boolean> {
        if (await this.notify_user_via_dm(user, message)) {
            return true;
        }
        return await this.notify_user_via_thread(parent_channel, user, message, thread_name);
    }
}
