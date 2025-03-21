import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { create_error_reply, Wheatley } from "./wheatley.js";
import { BotTextBasedCommand } from "./command-abstractions/text-based-command-descriptor.js";
import { BaseBotInteraction } from "./command-abstractions/interaction-base.js";
import { SelfClearingMap } from "./utils/containers.js";
import { MINUTE } from "./common.js";
import { TextBasedCommand } from "./command-abstractions/text-based-command.js";
import { BotModalHandler } from "./command-abstractions/modal.js";
import { unwrap } from "./utils/misc.js";
import { M } from "./utils/debugging-and-logging.js";
import { forge_snowflake } from "./utils/discord.js";

type issued_command_info = {
    command: TextBasedCommand;
    content: string;
};

type bot_reply_to_user_entry =
    | {
          type: "command";
          trigger_user: string;
          reply_object: TextBasedCommand;
      }
    | {
          type: "non_command";
          trigger_user: string;
          reply_object: Discord.Message;
      };

// Manages bot commands. Handles text and slash command dispatch, edit, delete, etc.
export class CommandHandler {
    // map of message snowflakes -> commands, used for making text commands deletable and editable
    private readonly issued_commands_map = new SelfClearingMap<string, issued_command_info>(30 * MINUTE);
    // map of message snowflakes -> bot replies, used for making other messages deletable based on a trigger
    private readonly non_command_bot_reply_map = new SelfClearingMap<string, Discord.Message>(30 * MINUTE);
    // map of message snowflakes -> user ids responsible for triggering the reply, used for :x:
    private readonly bot_reply_to_user_map = new SelfClearingMap<string, bot_reply_to_user_entry>(30 * MINUTE);

    constructor(
        private readonly wheatley: Wheatley,
        private readonly text_commands: Record<string, BotTextBasedCommand<unknown[]>>,
        private readonly other_commands: Record<string, BaseBotInteraction<unknown[]>>,
    ) {
        this.wheatley.client.on("messageCreate", (message: Discord.Message) => {
            this.on_message(message).catch(this.wheatley.critical_error.bind(this));
        });
        this.wheatley.client.on(
            "messageUpdate",
            (
                old_message: Discord.Message | Discord.PartialMessage,
                new_message: Discord.Message | Discord.PartialMessage,
            ) => {
                this.on_message_update(old_message, new_message).catch(
                    this.wheatley.critical_error.bind(this.wheatley),
                );
            },
        );
        this.wheatley.client.on("messageDelete", (message: Discord.Message | Discord.PartialMessage) => {
            this.on_message_delete(message).catch(this.wheatley.critical_error.bind(this.wheatley));
        });
        this.wheatley.client.on("interactionCreate", (interaction: Discord.Interaction) => {
            this.on_interaction(interaction).catch(this.wheatley.critical_error.bind(this.wheatley));
        });
        this.wheatley.client.on(
            "messageReactionAdd",
            (reaction: Discord.MessageReaction | Discord.PartialMessageReaction) => {
                this.on_reaction_add(reaction).catch(this.wheatley.critical_error.bind(this.wheatley));
            },
        );
    }

    private register_issued_command(trigger: Discord.Message, command: TextBasedCommand) {
        this.issued_commands_map.set(trigger.id, { command, content: trigger.content });
    }

    public register_non_command_bot_reply(trigger: Discord.Message, message: Discord.Message) {
        this.non_command_bot_reply_map.set(trigger.id, message);
        this.bot_reply_to_user_map.set(message.id, {
            type: "non_command",
            trigger_user: trigger.author.id,
            reply_object: message,
        });
    }

    public get_command(command: string) {
        return this.text_commands[command];
    }

    //
    // Command dispatch
    //

    private static readonly command_regex = /^!(\S+)/;

    private async do_command_dispatch(
        command: BotTextBasedCommand<unknown[]>,
        command_obj: TextBasedCommand,
        ...command_options: unknown[]
    ) {
        await command.handler(command_obj, ...command_options);
        for (const reply of command_obj.replies) {
            this.bot_reply_to_user_map.set(reply.id, {
                type: "command",
                trigger_user: command_obj.user.id,
                reply_object: command_obj,
            });
        }
    }

    // returns false if the message was not a wheatley command
    private async handle_text_command(message: Discord.Message, prev_command_obj?: TextBasedCommand) {
        const match = message.content.match(CommandHandler.command_regex);
        if (match) {
            const command_name = match[1];
            if (command_name in this.text_commands) {
                let command_body = message.content.substring(match[0].length).trim();
                let command = this.text_commands[command_name];
                const command_obj = prev_command_obj
                    ? new TextBasedCommand(prev_command_obj, command_name, command, message)
                    : new TextBasedCommand(command_name, command, message, this.wheatley);
                this.register_issued_command(message, command_obj);
                let command_log_name = command_name;
                if (command.subcommands) {
                    // expect a subcommand argument
                    const re = /^\S+/;
                    const match = command_body.match(re);
                    const subcommand = match ? command.subcommands.get(match[0]) : undefined;
                    if (subcommand) {
                        command_log_name = `${command_name} ${match![0]}`;
                        command = unwrap(subcommand);
                        command_body = command_body.slice(unwrap(match)[0].length).trim();
                        command_obj.command_descriptor = command;
                    } else {
                        await command_obj.reply({ embeds: [command.command_info_and_description_embed()] });
                        return;
                    }
                }
                M.log(
                    `Received !${command_log_name}${prev_command_obj ? " (message edit)" : ""}`,
                    "From:",
                    message.author.tag,
                    message.author.id,
                    "At:",
                    message.url,
                    "Body:",
                    JSON.stringify(command_body),
                );
                if (command.permissions !== undefined) {
                    const member = await this.wheatley.try_fetch_tccpp_member(await command_obj.get_member());
                    if (!member || !member.permissions.has(command.permissions)) {
                        await command_obj.reply({
                            files: ["https://miro.medium.com/v2/resize:fit:750/1*lMV_u6tnu9WmFuJRyhTsFQ.jpeg"],
                            should_text_reply: true,
                        });
                        return;
                    }
                }
                const command_options = await command.parse_text_arguments(command_obj, message, command_body);
                if (command_options !== undefined) {
                    await this.do_command_dispatch(command, command_obj, ...command_options);
                }
                return true;
            } else {
                // unknown command
                return false;
            }
        } else {
            // starts with ! but doesn't match the command regex
            return false;
        }
    }

    private async handle_slash_comand(interaction: Discord.ChatInputCommandInteraction) {
        if (interaction.commandName in this.text_commands) {
            let command = this.text_commands[interaction.commandName];
            let command_log_name = interaction.commandName;
            if (interaction.options.getSubcommand(false)) {
                command_log_name = `${interaction.commandName} ${interaction.options.getSubcommand()}`;
                command = unwrap(unwrap(command.subcommands).get(interaction.options.getSubcommand()));
            }
            M.log(
                `Received /${command_log_name}`,
                "From:",
                interaction.user.tag,
                interaction.user.id,
                "At:",
                // eslint-disable-next-line max-len
                `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${forge_snowflake(Date.now())}`,
                "Args:",
                [
                    ...[...command.options.values()].map(opt => {
                        if (opt.type == "string") {
                            return JSON.stringify(interaction.options.getString(opt.title));
                        } else if (opt.type == "user") {
                            return interaction.options.getUser(opt.title)?.id;
                        } else if (opt.type == "role") {
                            return interaction.options.getRole(opt.title)?.name;
                        } else if (opt.type == "number") {
                            return interaction.options.getNumber(opt.title)?.toString();
                        } else {
                            return "<unknown>";
                        }
                    }),
                ],
            );
            const command_options: unknown[] = [];
            const command_object = new TextBasedCommand(interaction.commandName, command, interaction, this.wheatley);
            if (command.permissions !== undefined) {
                const member = await this.wheatley.try_fetch_tccpp_member(interaction.user.id);
                if (!member || !member.permissions.has(command.permissions)) {
                    await interaction.reply({
                        files: ["https://miro.medium.com/v2/resize:fit:750/1*lMV_u6tnu9WmFuJRyhTsFQ.jpeg"],
                    });
                    return;
                }
            }
            for (const option of command.options.values()) {
                if (option.type == "string") {
                    const option_value = interaction.options.getString(option.title);
                    if (!option_value && option.required) {
                        await command_object.reply(create_error_reply("Required argument not found"), true);
                        this.wheatley.critical_error("this shouldn't happen");
                        return;
                    }
                    if (option_value && option.regex && !option_value.trim().match(option.regex)) {
                        await command_object.reply(
                            create_error_reply(`Argument ${option.title} doesn't match expected format`),
                            true,
                        );
                        return;
                    }
                    command_options.push(option_value);
                } else if (option.type == "user") {
                    command_options.push(interaction.options.getUser(option.title));
                } else if (option.type == "role") {
                    command_options.push(interaction.options.getRole(option.title));
                } else if (option.type == "number") {
                    command_options.push(interaction.options.getNumber(option.title));
                } else {
                    assert(false, "unhandled option type");
                }
            }
            await command_object.maybe_early_reply();
            await this.do_command_dispatch(command, command_object, ...command_options);
        } else {
            // TODO unknown command
        }
    }

    //
    // Event callbacks
    //

    // TODO: Notify about critical errors.....
    private async on_message(message: Discord.Message) {
        try {
            // skip bots
            if (message.author.bot) {
                return;
            }
            if (message.content.startsWith("!")) {
                await this.handle_text_command(message);
            }
        } catch (e) {
            // TODO....
            this.wheatley.critical_error(e);
        }
    }

    private async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        try {
            if (this.issued_commands_map.has(new_message.id)) {
                const { command, content } = this.issued_commands_map.get(new_message.id)!;
                const message = !new_message.partial ? new_message : await new_message.fetch();
                // probably an embed update
                if (message.content === content) {
                    return;
                }
                if (command.replies.length > 1) {
                    await command.edit(
                        "Can't edit command that replied in multiple parts, please re-issue your command",
                        true,
                    );
                    await command.delete_follow_ups();
                    return;
                }
                command.set_editing();
                if (!(await this.handle_text_command(message, command))) {
                    // returns false if the message was not a wheatley command; delete replies and remove from map
                    await command.delete_replies_if_replied();
                    this.issued_commands_map.remove(new_message.id);
                }
            }
        } catch (e) {
            // TODO....
            this.wheatley.critical_error(e);
        }
    }

    private async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        try {
            if (this.issued_commands_map.has(message.id)) {
                const { command } = this.issued_commands_map.get(message.id)!;
                this.issued_commands_map.remove(message.id);
                await command.delete_replies_if_replied();
            } else if (this.non_command_bot_reply_map.has(message.id)) {
                const target = this.non_command_bot_reply_map.get(message.id)!;
                this.non_command_bot_reply_map.remove(message.id);
                try {
                    await target.delete();
                } catch (e) {
                    if (e instanceof Discord.DiscordAPIError && e.code == 10008) {
                        // pass, ignore - response deleted before trigger
                    } else {
                        throw e;
                    }
                }
            }
        } catch (e) {
            // TODO....
            this.wheatley.critical_error(e);
        }
    }

    async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction) {
        const emoji_name = reaction.emoji.name?.toLowerCase();
        assert(emoji_name != null);
        if (emoji_name === "❌" && this.bot_reply_to_user_map.has(reaction.message.id)) {
            const {
                type: reply_type,
                trigger_user,
                reply_object,
            } = unwrap(this.bot_reply_to_user_map.get(reaction.message.id));
            if (reaction.users.cache.has(trigger_user)) {
                if (reply_type === "command") {
                    await reply_object.delete_replies_if_replied();
                } else {
                    await reply_object.delete();
                }
            } else {
                await Promise.all(reaction.users.cache.map(user => reaction.users.remove(user)));
            }
        }
    }

    private async on_interaction(interaction: Discord.Interaction) {
        try {
            if (interaction.isChatInputCommand()) {
                await this.handle_slash_comand(interaction);
            } else if (interaction.isAutocomplete()) {
                if (interaction.commandName in this.text_commands) {
                    const command = this.text_commands[interaction.commandName];
                    // TODO: permissions sanity check?
                    const field = interaction.options.getFocused(true);
                    assert(command.options.has(field.name));
                    const option = command.options.get(field.name)!;
                    assert(option.autocomplete);
                    await interaction.respond(
                        option.autocomplete(field.value, interaction.commandName).map(({ name, value }) => ({
                            name: name.substring(0, 100),
                            value: value.substring(0, 100),
                        })),
                    );
                } else {
                    // TODO unknown command
                }
            } else if (interaction.isMessageContextMenuCommand()) {
                assert(interaction.commandName in this.other_commands);
                M.log(
                    `Received message context menu interaction ${interaction.commandName}`,
                    "From:",
                    interaction.user.tag,
                    interaction.user.id,
                    "At:",
                    interaction.targetMessage.url,
                );
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if (interaction.isUserContextMenuCommand()) {
                assert(interaction.commandName in this.other_commands);
                M.log(
                    `Received user context menu interaction ${interaction.commandName}`,
                    "From:",
                    interaction.user.tag,
                    interaction.user.id,
                );
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if (interaction.isModalSubmit()) {
                const [command_name, id] = interaction.customId.split("--") as [string, string | undefined];
                // TODO: Can't assert atm
                if (command_name in this.other_commands) {
                    const command = this.other_commands[command_name] as BotModalHandler;
                    const fields = command.fields.map(id => interaction.fields.getTextInputValue(id));
                    await command.handler(interaction, ...(id ? [id, ...fields] : fields));
                }
            } else if (interaction.isButton()) {
                M.log(
                    `Received button interaction ${interaction.customId}`,
                    "From:",
                    interaction.user.tag,
                    interaction.user.id,
                );
                // TODO: permissions
                if (interaction.customId in this.other_commands) {
                    await this.other_commands[interaction.customId].handler(interaction);
                }
            }
            // TODO: Notify if errors occur in the handler....
        } catch (e) {
            // TODO....
            this.wheatley.critical_error(e);
        }
    }
}
