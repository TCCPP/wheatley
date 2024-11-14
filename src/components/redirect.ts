import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { colors } from "../common.js";
import { delay } from "../utils/misc.js";
import { M } from "../utils/debugging-and-logging.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { format_list } from "../utils/strings.js";

export default class Redirect extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
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
    }

    override async setup() {
        this.add_command(
            new TextBasedCommandBuilder("r", EarlyReplyMode.none)
                .set_description(
                    `Redirect a conversation from <#${this.wheatley.channels.c_cpp_discussion.id}> or ` +
                        `<#${this.wheatley.channels.general_discussion.id}> to a help channel`,
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
        await command.channel.permissionOverwrites.edit(this.wheatley.TCCPP.id, { SendMessages: false });
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
            (
                [
                    "cpp_help",
                    "cpp_help_text",
                    "c_help",
                    "c_help_text",
                    "tooling",
                    "algorithms_and_compsci",
                ] as (keyof Wheatley["channels"])[]
            )
                .map(name => this.wheatley.channels[name].id)
                .includes(command.channel_id)
        ) {
            await command.reply("Can't be used in a help channel", true);
            return;
        }

        await command.reply({
            content:
                `Hello <@${user.id}>, welcome to Together C & C++! This is not a help channel, please ask your ` +
                `question in one of the help channels above (${format_list(
                    (<(keyof Wheatley["channels"])[]>[])
                        .concat("cpp_help", "cpp_help_text", "c_help", "c_help_text")
                        .map(name => `<#${this.wheatley.channels[name].id}>`),
                )}), ` +
                `or <#${this.wheatley.channels.tooling.id}> if your question is about tooling, ` +
                `or <#${this.wheatley.channels.algorithms_and_compsci.id}> if your question pertains more to theory, ` +
                `or any other help channel more suited for your quesiton.`,
            should_text_reply: false,
        });
    }
}
