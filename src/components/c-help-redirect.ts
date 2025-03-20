import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { HOUR, DAY } from "../common.js";
import { M } from "../utils/debugging-and-logging.js";
import { SelfClearingSet } from "../utils/containers.js";

const code_block_start = "```";

const cpp_keywords = [
    "std::", // just :: would work too, this is slightly less prone to false positives
    "using namespace ",
    "class ",
    "typename ",
    "template",
    "virtual ",
    "dynamic_cast",
    "static_cast",
    "const_cast",
    "reinterpret_cast",
    "= new ", // too common to include just "new"
    // "delete ", // too common
    "delete[]",
    "public:",
    "protected:",
    "private:",
];

const not_c_keywords = [
    "explicit",
    "mutable",
    "final",
    "try",
    "catch",
    "throw",
    "operator", // possibly list all operator+ etc. to be on the safe side
    "cout<<",
    "cout <<",
    "cin>>",
    "cin >>",
    "<iostream>",
    "<cstdio>",
];

const maybe_c_keywords = [
    "printf",
    "scanf",
    "<stdio.h>",
    "<stdlib.h>",
    "<math.h>",
    "malloc",
    "calloc",
    "realloc",
    "free(", // too common to include just "free"
];

/**
 * Checks for cpp code in #c-help-text and suggests #cpp-help-text instead, and vice versa
 */
export default class CHelpRedirect extends BotComponent {
    // For timeouts on triggering on the same user
    // use the same set for both channels, shouldn't be an issue in practice
    readonly auto_triggered_users = new SelfClearingSet<string>(1 * HOUR);

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("not-c", EarlyReplyMode.none)
                .set_description("Mark C++ code in the C help channel")
                .add_user_option({
                    title: "user",
                    description: "User who posted the code",
                    required: false,
                })
                .set_handler(this.not_c.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("not-cpp", EarlyReplyMode.none)
                .set_description("Mark C code in the C++ help channel")
                .add_user_option({
                    title: "user",
                    description: "User who posted the code",
                    required: false,
                })
                .set_handler(this.not_cpp.bind(this)),
        );
    }

    async is_not_new_member(message: Discord.Message) {
        let member: Discord.GuildMember;
        if (message.member == null) {
            try {
                member = await message.guild!.members.fetch(message.author.id);
            } catch (error) {
                M.warn("Failed to get user", message.author.id);
                return false;
            }
        } else {
            member = message.member;
        }
        assert(member.joinedTimestamp != null);
        return Date.now() - member.joinedTimestamp >= 7 * DAY;
    }

    check_message_for_cpp_code(message: Discord.Message): boolean {
        if (!message.content.includes(code_block_start)) {
            // To avoid false positives, only check inside code blocks
            return false;
        }

        let text = message.content;

        while (text.search(code_block_start) > -1) {
            const start = text.search(code_block_start);
            const end = text.substring(start + code_block_start.length).search(code_block_start);
            const block = text.substring(start + code_block_start.length, start + code_block_start.length + end);

            for (const keyword of cpp_keywords) {
                if (block.includes(keyword)) {
                    return true;
                }
            }

            text = text.substring(start + code_block_start.length + end + code_block_start.length);
        }
        return false;
    }

    check_message_for_c_code(message: Discord.Message): boolean {
        if (!message.content.includes(code_block_start)) {
            // To avoid false positives, only check inside code blocks
            return false;
        }

        let text = message.content;

        while (text.search(code_block_start) > -1) {
            const start = text.search(code_block_start);
            const end = text.substring(start + code_block_start.length).search(code_block_start);
            const block = text.substring(start + code_block_start.length, start + code_block_start.length + end);

            // For C code, the block must not have any C++ keywords
            // including inconclusive keywords
            // and have some C keyword

            let c_code_found = false;
            let cpp_code_found = false;

            for (const keyword of cpp_keywords) {
                if (block.includes(keyword)) {
                    cpp_code_found = true;
                }
            }

            for (const keyword of not_c_keywords) {
                if (block.includes(keyword)) {
                    cpp_code_found = true;
                }
            }

            for (const keyword of maybe_c_keywords) {
                if (block.includes(keyword)) {
                    c_code_found = true;
                }
            }

            if (c_code_found && !cpp_code_found) {
                return true;
            }

            text = text.substring(start + code_block_start.length + end + code_block_start.length);
        }
        return false;
    }

    async not_c(command: TextBasedCommand, user: Discord.User | null) {
        assert(command.channel);
        assert(command.channel instanceof Discord.GuildChannel);

        // Only allowed in #c-help-text
        if (command.channel.id != this.wheatley.channels.c_help_text.id) {
            await command.reply(`Can only be used in <#${this.wheatley.channels.c_help_text.id}>`, true);
            return;
        }

        // For manual triggers, trust the caller and don't check the message
        // Supposedly the automatic check didn't trigger, so checking the message again would fail again
        if (user) {
            await command.channel.send(
                `<@${user.id}> Your code looks like C++ code, but this is a C channel. ` +
                    `Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>?`,
            );
        } else {
            await command.channel.send(
                `This code looks like C++ code, but this is a C channel. ` +
                    `Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>?`,
            );
        }
    }

    async not_cpp(command: TextBasedCommand, user: Discord.User | null) {
        assert(command.channel);
        assert(command.channel instanceof Discord.GuildChannel);

        // Only allowed in #cpp-help-text
        if (command.channel.id != this.wheatley.channels.cpp_help_text.id) {
            await command.reply(`Can only be used in <#${this.wheatley.channels.cpp_help_text.id}>`, true);
            return;
        }

        // For manual triggers, trust the caller and don't check the message
        // Supposedly the automatic check didn't trigger, so checking the message again would fail again
        if (user) {
            await command.channel.send(
                `<@${user.id}> Your code looks like C code, but this is a C++ channel. ` +
                    `Did you mean to post in <#${this.wheatley.channels.c_help_text.id}>?`,
            );
        } else {
            await command.channel.send(
                `This code looks like C code, but this is a C++ channel. ` +
                    `Did you mean to post in <#${this.wheatley.channels.c_help_text.id}>?`,
            );
        }
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
        if (
            message.author.id == this.wheatley.client.user!.id ||
            message.author.bot ||
            message.guildId != this.wheatley.TCCPP.id
        ) {
            return;
        }

        // Only auto-check new members
        if (await this.is_not_new_member(message)) {
            return;
        }

        // Timeout for triggering on the same user
        if (this.auto_triggered_users.has(message.author.id)) {
            return;
        }

        // Only check messages in help-text channels
        if (message.channel.id == this.wheatley.channels.c_help_text.id) {
            if (this.check_message_for_cpp_code(message)) {
                this.auto_triggered_users.insert(message.author.id);
                await message.reply(
                    `<@${message.author.id}> Your code looks like C++ code, but this is a C channel. ` +
                        `Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>?`,
                );
            }
        } else if (message.channel.id == this.wheatley.channels.cpp_help_text.id) {
            if (this.check_message_for_c_code(message)) {
                this.auto_triggered_users.insert(message.author.id);
                await message.reply(
                    `<@${message.author.id}> Your code looks like C code, but this is a C++ channel. ` +
                        `Did you mean to post in <#${this.wheatley.channels.c_help_text.id}>?`,
                );
            }
        }
    }
}
