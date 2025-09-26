import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { delay } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { format_list } from "../utils/strings.js";

export default class Redirect extends BotComponent {
    private c_cpp_discussion: Discord.TextChannel;
    private general_discussion: Discord.TextChannel;
    private cpp_help: Discord.TextChannel;
    private cpp_help_text: Discord.TextChannel;
    private c_help: Discord.TextChannel;
    private c_help_text: Discord.TextChannel;
    private tooling: Discord.TextChannel;
    private algorithms_and_compsci: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.c_cpp_discussion = await this.utilities.get_channel(this.wheatley.channels.c_cpp_discussion);
        this.general_discussion = await this.utilities.get_channel(this.wheatley.channels.general_discussion);
        this.cpp_help = await this.utilities.get_channel(this.wheatley.channels.cpp_help);
        this.cpp_help_text = await this.utilities.get_channel(this.wheatley.channels.cpp_help_text);
        this.c_help = await this.utilities.get_channel(this.wheatley.channels.c_help);
        this.c_help_text = await this.utilities.get_channel(this.wheatley.channels.c_help_text);
        this.tooling = await this.utilities.get_channel(this.wheatley.channels.tooling);
        this.algorithms_and_compsci = await this.utilities.get_channel(this.wheatley.channels.algorithms_and_compsci);
        commands.add(
            new TextBasedCommandBuilder("redirect", EarlyReplyMode.visible)
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
                .set_description(
                    `Redirect a conversation from <#${this.c_cpp_discussion.id}> or ` +
                        `<#${this.general_discussion.id}> to a help channel`,
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
                this.cpp_help.id,
                this.cpp_help_text.id,
                this.c_help.id,
                this.c_help_text.id,
                this.tooling.id,
                this.algorithms_and_compsci.id,
            ].includes(command.channel_id)
        ) {
            await command.reply("Can't be used in a help channel", true);
            return;
        }

        await command.reply({
            content:
                `Hello <@${user.id}>, welcome to Together C & C++! This is not a help channel, please ask your ` +
                `question in one of the help channels above (${format_list([
                    `<#${this.cpp_help.id}>`,
                    `<#${this.cpp_help_text.id}>`,
                    `<#${this.c_help.id}>`,
                    `<#${this.c_help_text.id}>`,
                ])}), ` +
                `or <#${this.tooling.id}> if your question is about tooling, ` +
                `or <#${this.algorithms_and_compsci.id}> if your question pertains more to theory, ` +
                `or any other help channel more suited for your question.`,
            should_text_reply: false,
        });
    }
}
