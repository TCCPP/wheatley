import { strict as assert } from "assert";
import { REST } from "@discordjs/rest";
import * as Discord from "discord.js";

import { BotTextBasedCommand } from "./text-based-command-descriptor.js";
import { BaseBotInteraction } from "./interaction-base.js";
import { TextBasedCommandBuilder } from "./text-based-command-builder.js";
import { MessageContextMenuInteractionBuilder } from "./context-menu.js";
import { ModalInteractionBuilder, BotModal, BotModalHandler } from "./modal.js";
import { BotButton, BotButtonHandler, ButtonInteractionBuilder } from "./button.js";

import * as util from "util";

import { M } from "../utils/debugging-and-logging.js";
import { Wheatley } from "../wheatley.js";

const global_context_menu_limit = 5;

export class CommandSetBuilder {
    commands: (Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder)[] = [];
    text_commands: Record<string, BotTextBasedCommand<unknown[]>> = {};
    other_commands: Record<string, BaseBotInteraction<unknown[]>> = {};
    button_handlers: Record<string, BotButtonHandler<any[]>> = {};
    modal_handlers: Record<string, BotModalHandler<any[]>> = {};

    constructor(readonly wheatley: Wheatley) {}

    private register(builder: Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder | undefined) {
        if (builder) {
            this.commands.push(builder);
        }
    }

    public add<T extends unknown[]>(command: TextBasedCommandBuilder<T, true, true>): void;
    public add<T extends unknown[]>(command: TextBasedCommandBuilder<T, true, false, true>): void;
    public add<T extends unknown[]>(command: MessageContextMenuInteractionBuilder<true>): void;
    public add<T extends unknown[]>(command: ModalInteractionBuilder<T, true>): BotModal<T>;
    public add<T extends unknown[]>(command: ButtonInteractionBuilder<T, true>): BotButton<T>;
    public add<T extends unknown[]>(
        command:
            | TextBasedCommandBuilder<T, true, true>
            | TextBasedCommandBuilder<T, true, false, true>
            | MessageContextMenuInteractionBuilder<true>
            | ModalInteractionBuilder<T, true>
            | ButtonInteractionBuilder<T, true>,
    ) {
        if (command instanceof TextBasedCommandBuilder) {
            for (const descriptor of command.to_command_descriptors(this.wheatley)) {
                assert(!(descriptor.name in this.text_commands));
                this.text_commands[descriptor.name] = descriptor;
                if (descriptor.slash) {
                    this.register(descriptor.to_slash_command(new Discord.SlashCommandBuilder()));
                }
            }
        } else if (command instanceof ButtonInteractionBuilder) {
            const button_handler = command.build_handler();
            assert(button_handler, "Button handler builder must have handler set");
            assert(
                !(command.base_custom_id in this.button_handlers),
                `Button handler ${command.base_custom_id} already registered`,
            );

            this.button_handlers[command.base_custom_id] = button_handler;
            M.log(`Registered button handler: ${command.base_custom_id}`);
            return command.build_button();
        } else if (command instanceof ModalInteractionBuilder) {
            const modal_handler = command.build_handler();
            assert(modal_handler, "Modal handler builder must have handler set");
            assert(
                !(command.base_custom_id in this.modal_handlers),
                `Modal handler ${command.base_custom_id} already registered`,
            );

            this.modal_handlers[command.base_custom_id] = modal_handler;
            M.log(`Registered modal handler: ${command.base_custom_id}`);
            return command.build_modal();
        } else {
            assert(!(command.name in this.other_commands));
            const [bot_command, djs_command] = command.to_command_descriptors();
            this.other_commands[command.name] = bot_command as BaseBotInteraction<unknown[]>;
            this.register(djs_command);
        }
    }

    async finalize(token: string) {
        try {
            const rest = new REST({ version: "10" }).setToken(token);
            if (this.wheatley.freestanding) {
                const route = Discord.Routes.applicationGuildCommands(this.wheatley.user.id, this.wheatley.guild.id);
                this.wheatley.info(`Registering ${this.commands.length} application commands to guild`);
                M.log(
                    "Sending application commands to guild:",
                    this.commands.length,
                    this.commands.map(builder => builder.name),
                );
                await rest.put(route, { body: this.commands });
            } else {
                const slash_commands = this.commands.filter(cmd => cmd instanceof Discord.SlashCommandBuilder);
                const context_menu_commands = this.commands.filter(
                    cmd => cmd instanceof Discord.ContextMenuCommandBuilder,
                );

                const global_context_menu_commands = context_menu_commands.slice(0, global_context_menu_limit);
                const guild_context_menu_commands = context_menu_commands.slice(global_context_menu_limit);

                const global_commands = [...slash_commands, ...global_context_menu_commands];

                this.wheatley.info(
                    `Registering ${global_commands.length} commands globally ` +
                        `(${slash_commands.length} slash, ${global_context_menu_commands.length} context menu) and ` +
                        `${guild_context_menu_commands.length} context menu commands to guild`,
                );

                if (global_commands.length > 0) {
                    M.log(
                        "Sending commands globally:",
                        global_commands.length,
                        global_commands.map(builder => builder.name),
                    );
                    await rest.put(Discord.Routes.applicationCommands(this.wheatley.user.id), {
                        body: global_commands,
                    });
                }

                if (guild_context_menu_commands.length > 0) {
                    M.log(
                        "Sending context menu commands to guild:",
                        guild_context_menu_commands.length,
                        guild_context_menu_commands.map(builder => builder.name),
                    );
                    await rest.put(
                        Discord.Routes.applicationGuildCommands(this.wheatley.user.id, this.wheatley.guild.id),
                        {
                            body: guild_context_menu_commands,
                        },
                    );
                }
            }
            M.log("Finished sending commands");
            return {
                text_commands: this.text_commands,
                button_handlers: this.button_handlers,
                modal_handlers: this.modal_handlers,
                other_commands: this.other_commands,
            };
        } catch (e) {
            M.log(util.inspect({ body: this.commands }, { showHidden: false, depth: null, colors: true }));
            this.wheatley.critical_error(e);
            throw e;
        }
    }
}
