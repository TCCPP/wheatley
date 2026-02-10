import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { colors } from "../../../common.js";
import { delay } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { format_list } from "../../../utils/strings.js";
import { channel_map } from "../../../channel-map.js";
import { role_map } from "../../../role-map.js";
import { wheatley_channels } from "../channels.js";
import { wheatley_roles } from "../roles.js";

export default class Redirect extends BotComponent {
    private roles = role_map(this.wheatley, wheatley_roles.moderators);
    private channels = channel_map(
        this.wheatley,
        wheatley_channels.cpp_help,
        wheatley_channels.cpp_help_text,
        wheatley_channels.c_help,
        wheatley_channels.c_help_text,
        wheatley_channels.c_cpp_discussion,
        wheatley_channels.general_discussion,
        wheatley_channels.tooling,
        wheatley_channels.algorithms_and_compsci,
    );

    override async setup(commands: CommandSetBuilder) {
        await this.channels.resolve();
        this.roles.resolve();

        commands.add(
            new TextBasedCommandBuilder("redirect", EarlyReplyMode.visible)
                .set_category("Moderation Utilities")
                .set_description("Redirect a conversation")
                .add_string_option({
                    title: "channel",
                    description: "channel",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.redirect.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("r", EarlyReplyMode.none)
                .set_category("Moderation Utilities")
                .set_description(
                    `Redirect a conversation from <#${this.channels.c_cpp_discussion.id}> or ` +
                        `<#${this.channels.general_discussion.id}> to a help channel`,
                )
                .add_user_option({
                    title: "user",
                    description: "User to redirect",
                    required: true,
                })
                .set_handler(this.r.bind(this)),
        );
    }

    async redirect(command: TextBasedCommand, arg: string) {
        M.log("Redirect command received");
        assert(command.channel);
        assert(command.channel instanceof Discord.GuildChannel);
        const initial_permissions = command.channel.permissionOverwrites.cache.clone();
        await command.channel.permissionOverwrites.edit(this.wheatley.guild.roles.everyone.id, { SendMessages: false });
        await command.channel.permissionOverwrites.edit(this.roles.moderators.id, { SendMessages: true });
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle("Channel Locked")
                    .setDescription(
                        `Please move the current conversation to ${arg}.` +
                            "\nThe channel will be unlocked in 30 seconds.",
                    )
                    .setColor(colors.wheatley),
            ],
        });
        await delay(30 * 1000);
        await command.channel.permissionOverwrites.set(initial_permissions);
        //await command.channel.permissionOverwrites.edit(TCCPP_ID, { SendMessages: null });
    }

    async r(command: TextBasedCommand, user: Discord.User) {
        if (
            [
                this.channels.cpp_help,
                this.channels.cpp_help_text,
                this.channels.c_help,
                this.channels.c_help_text,
                this.channels.tooling,
                this.channels.algorithms_and_compsci,
            ].some(channel => channel.id === command.channel_id)
        ) {
            await command.reply("Can't be used in a help channel", true);
            return;
        }

        await command.reply({
            content:
                `Hello <@${user.id}>, welcome to ${this.wheatley.guild.name}! ` +
                `This is not a help channel, please ask your question in one of the help channels above (${format_list([
                    `<#${this.channels.cpp_help.id}>`,
                    `<#${this.channels.cpp_help_text.id}>`,
                    `<#${this.channels.c_help.id}>`,
                    `<#${this.channels.c_help_text.id}>`,
                ])}), ` +
                `or <#${this.channels.tooling.id}> if your question is about tooling, ` +
                `or <#${this.channels.algorithms_and_compsci.id}> if your question pertains more to theory, ` +
                `or any other help channel more suited for your question.`,
            should_text_reply: false,
        });
    }
}
