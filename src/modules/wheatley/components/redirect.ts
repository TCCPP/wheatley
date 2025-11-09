import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { colors } from "../../../common.js";
import { delay } from "../../../utils/misc.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { format_list } from "../../../utils/strings.js";

export default class Redirect extends BotComponent {
    override async setup(commands: CommandSetBuilder) {
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
                    `Redirect a conversation from <#${this.wheatley.channels.c_cpp_discussion}> or ` +
                        `<#${this.wheatley.channels.general_discussion}> to a help channel`,
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
        await command.channel.permissionOverwrites.edit(this.wheatley.roles.moderators.id, { SendMessages: true });
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
                this.wheatley.channels.cpp_help,
                this.wheatley.channels.cpp_help_text,
                this.wheatley.channels.c_help,
                this.wheatley.channels.c_help_text,
                this.wheatley.channels.tooling,
                this.wheatley.channels.algorithms_and_compsci,
            ].includes(command.channel_id)
        ) {
            await command.reply("Can't be used in a help channel", true);
            return;
        }

        await command.reply({
            content:
                `Hello <@${user.id}>, welcome to Together C & C++! This is not a help channel, please ask your ` +
                `question in one of the help channels above (${format_list([
                    `<#${this.wheatley.channels.cpp_help}>`,
                    `<#${this.wheatley.channels.cpp_help_text}>`,
                    `<#${this.wheatley.channels.c_help}>`,
                    `<#${this.wheatley.channels.c_help_text}>`,
                ])}), ` +
                `or <#${this.wheatley.channels.tooling}> if your question is about tooling, ` +
                `or <#${this.wheatley.channels.algorithms_and_compsci}> if your question pertains more to theory, ` +
                `or any other help channel more suited for your question.`,
            should_text_reply: false,
        });
    }
}
