import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

const code_block_start = "```";

const cpp_keywords = [
  "std::", //just :: would work too, this is slightly less prone to false positives
  "using namespace ",
  "class ",
  "typename ",
  "template",
  "virtual ",
  "dynamic_cast",
  "static_cast",
  "const_cast",
  "reinterpret_cast",
  "new ",
  "delete ",
  "public:",
  "protected:",
  "private:",
  // other cpp-only keywords:
  //explicit/mutable/final
  //try/catch/throw
  //operator
  //"cout <<" / "cin >>"
  //true/false
];

/**
 * Checks for cpp code in #c-help-text and suggests #cpp-help-text instead
 */
export default class CHelpRedirect extends BotComponent {
  constructor(wheatley: Wheatley) {
    super(wheatley);

    this.add_command(
      new TextBasedCommandBuilder("not-c")
        .set_description("Mark C++ code in the C help channel")
        .add_user_option({
          title: "user",
          description: "User who posted the code",
          required: false,
        })
        .set_handler(this.not_c.bind(this)),
    );
  }

  check_message(message: Discord.Message): boolean {
    if (!message.content.includes(code_block_start)) {
      // to avoid false positives, only check inside code blocks
      return false;
    }

    let text = message.content;

    while (text.search(code_block_start) > -1) {
      let start = text.search(code_block_start);
      let end = text
        .substring(start + code_block_start.length)
        .search(code_block_start);
      let block = text.substring(
        start + code_block_start.length,
        start + code_block_start.length + end,
      );

      for (const keyword of cpp_keywords) {
        if (block.includes(keyword)) {
          return true;
        }
      }

      text = text.substring(
        start + code_block_start.length + end + code_block_start.length,
      );
    }
    return false;
  }

  async not_c(command: TextBasedCommand, user: Discord.User | null) {
    assert(command.channel);
    assert(command.channel instanceof Discord.GuildChannel);
    //for manual triggers, trust the caller and don't check the message
    //supposedly the automatic check didn't trigger, so checking the message again would fail again
    if (user) {
      await command.channel.send(
        `<@${user.id}> Your code looks like C++ code, but this is a C channel. Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>? `,
      );
    } else {
      await command.channel.send(
        `This code looks like C++ code, but this is a C channel. Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>?`,
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

    // Only check messages in #c-help-text
    if (message.channel.id != this.wheatley.channels.c_help_text.id) {
      return;
    }

    if (this.check_message(message)) {
      await message.reply(
        `<@${message.author.id}> Your code looks like C++ code, but this is a C channel. Did you mean to post in <#${this.wheatley.channels.cpp_help_text.id}>?`,
      );
    }
  }
}
