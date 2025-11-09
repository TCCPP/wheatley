import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { unwrap } from "../../../../utils/misc.js";

type voice_limit_entry = {
    channel: string;
    new_limit: number;
    old_limit: number;
    issuer: string;
};

export default class DynamicRoomSize extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        voice_limits: voice_limit_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("voice-limit", EarlyReplyMode.ephemeral)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .set_description("Manage voice channel user limits")
                .set_slash(true)
                .add_subcommand(
                    new TextBasedCommandBuilder("bump", EarlyReplyMode.ephemeral)
                        .set_description("Bump channel limit")
                        .add_number_option({
                            title: "count",
                            description: "count to increase channel limit by",
                            required: false,
                        })
                        .set_handler(
                            async (command: TextBasedCommand, limit: number | null) =>
                                await this.handle_push(false, command, limit),
                        ),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("set", EarlyReplyMode.ephemeral)
                        .set_description("Push new channel limit")
                        .add_number_option({
                            title: "limit",
                            description: "new channel limit",
                            required: true,
                        })
                        .set_handler(
                            async (command: TextBasedCommand, limit: number) =>
                                await this.handle_push(true, command, limit),
                        ),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("pop", EarlyReplyMode.ephemeral)
                        .set_description("Pop channel limit")
                        .set_handler(this.handle_pop.bind(this)),
                ),
        );
    }

    private handle_push<Absolute extends false>(
        absolute: Absolute,
        command: TextBasedCommand,
        limit: number | null,
    ): Promise<void>;
    private handle_push<Absolute extends true>(
        absolute: Absolute,
        command: TextBasedCommand,
        limit: number,
    ): Promise<void>;
    private async handle_push<Absolute extends boolean>(
        absolute: Absolute,
        command: TextBasedCommand,
        limit: number | null,
    ) {
        try {
            if ((await command.get_member()).voice.channelId != command.channel_id) {
                throw Error("command can only be used in a voice channel you're currently in");
            }
            if (!command.channel?.isVoiceBased()) {
                throw Error("command can only be used in voice channel");
            }
            limit = absolute ? unwrap(limit) : command.channel.userLimit + (limit ?? 1);
            const res = await this.database.voice_limits.findOneAndUpdate(
                { channel: command.channel_id },
                {
                    $set: {
                        new_limit: limit,
                        issuer: command.user.id,
                    },
                    $setOnInsert: {
                        channel: command.channel_id,
                        old_limit: command.channel.userLimit,
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            assert(res);
            M.log(`🔊 ${command.channel.name} voice limit bumped to ${limit} by ${command.user.displayName}`);
            await command.channel.setUserLimit(res.new_limit);
            await command.replyOrFollowUp(`${this.wheatley.emoji.success} limit is now ${res.new_limit}`);
        } catch (e) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} ${e}`, true);
        }
    }

    private async handle_pop(command: TextBasedCommand) {
        try {
            if (!command.channel?.isVoiceBased()) {
                throw Error("command can only be used in voice channel");
            }
            const res = await this.database.voice_limits.findOneAndDelete({ channel: command.channel_id });
            if (!res) {
                throw Error("no limit on stack");
            }
            M.log(
                `🔊 ${command.channel.name} voice limit popped back to ${res.old_limit} by ${command.user.displayName}`,
            );
            await command.channel.setUserLimit(res.old_limit);
            await command.replyOrFollowUp(`${this.wheatley.emoji.success} limit is now ${res.old_limit}`);
        } catch (e) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} ${e}`, true);
        }
    }

    private async mod_has_left_the_building(channel: Discord.Channel) {
        assert(channel.isVoiceBased());
        for (const [id, member] of channel.members) {
            if (await this.wheatley.check_permissions(member, Discord.PermissionFlagsBits.MuteMembers)) {
                return;
            }
        }
        const res = await this.database.voice_limits.findOneAndDelete({ channel: channel.id });
        if (res) {
            M.log(`🔊 ${channel.name} auto reset voice limit to ${res.old_limit}`);
            await channel.setUserLimit(res.old_limit);
        }
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        assert(new_state.member);
        if (
            new_state.member.permissions.has(Discord.PermissionFlagsBits.MuteMembers) &&
            old_state.channel &&
            new_state.channelId != old_state.channelId
        ) {
            await this.mod_has_left_the_building(old_state.channel);
        }
    }

    async check_limits() {
        const entries = await this.database.voice_limits.find().toArray();
        for (const entry of entries) {
            const channel = await this.wheatley.guild.channels.fetch(entry.channel);
            if (channel) {
                await this.mod_has_left_the_building(channel);
            } else {
                M.info(`Deleting stale voice limit entry ${entry}`);
                const res = await this.database.voice_limits.deleteOne(entry);
                assert(res.acknowledged);
            }
        }
    }

    override async on_ready() {
        await this.check_limits();
    }
}
