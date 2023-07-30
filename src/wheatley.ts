import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { EventEmitter } from "events";
import * as fs from "fs/promises";

import {
    action_log_channel_id, bot_spam_id, colors, cpp_help_id, c_help_id, member_log_channel_id,
    message_log_channel_id, MINUTE, mods_channel_id, rules_channel_id, server_suggestions_channel_id,
    staff_flag_log_id, suggestion_action_log_thread_id, suggestion_dashboard_thread_id, TCCPP_ID,
    welcome_channel_id, zelis_id, the_button_channel_id, skill_role_suggestion_log_id,
    starboard_channel_id,
    staff_action_log_channel_id, fetch_root_mod_list
} from "./common.js";
import { critical_error, fetch_forum_channel, fetch_text_channel, fetch_thread_channel, M, directory_exists,
         SelfClearingMap, string_split, zip } from "./utils.js";
import { BotComponent } from "./bot-component.js";
import { BotCommand, BotModalHandler, BotTextBasedCommand, MessageContextMenuCommandBuilder, ModalHandler,
         TextBasedCommand, TextBasedCommandBuilder } from "./command.js";

import { DatabaseInterface } from "./infra/database-interface.js";
import { GuildCommandManager } from "./infra/guild-command-manager.js";
import { MemberTracker } from "./infra/member-tracker.js";

import { forge_snowflake } from "./components/snowflake.js";

function create_basic_embed(title: string | undefined, color: number, content: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(content);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

type text_command_map_target = {
    command: TextBasedCommand;
    deletable: boolean;
};

export type authentication = {
    id: string;
    guild?: string;
    token: string;
    freestanding?: boolean;
};

export class Wheatley extends EventEmitter {
    private components: BotComponent[] = [];
    readonly guild_command_manager: GuildCommandManager;
    readonly tracker: MemberTracker; // TODO: Rename
    action_log_channel: Discord.TextChannel;
    staff_flag_log: Discord.TextChannel;
    staff_message_log: Discord.TextChannel;
    TCCPP: Discord.Guild;
    zelis: Discord.User;
    cpp_help: Discord.ForumChannel;
    c_help: Discord.ForumChannel;
    rules_channel: Discord.TextChannel;
    mods_channel: Discord.TextChannel;
    staff_member_log_channel: Discord.TextChannel;
    welcome_channel: Discord.TextChannel;
    bot_spam: Discord.TextChannel;
    server_suggestions_channel: Discord.TextChannel;
    suggestion_dashboard_thread: Discord.ThreadChannel;
    suggestion_action_log_thread: Discord.ThreadChannel;
    the_button_channel: Discord.TextChannel;
    skill_role_suggestion_log: Discord.TextChannel;
    starboard_channel: Discord.TextChannel;
    staff_action_log_channel: Discord.TextChannel;

    link_blacklist: any;

    text_commands: Record<string, BotTextBasedCommand<any>> = {};
    other_commands: Record<string, BotCommand<any>> = {};

    // map of message snowflakes -> commands, used for making text commands deletable and editable
    text_command_map = new SelfClearingMap<string, text_command_map_target>(30 * MINUTE);
    // map of message snowflakes -> commands, used for making other messages deletable based on a trigger
    deletable_map = new SelfClearingMap<string, Discord.Message>(30 * MINUTE);

    // whether wheatley is ready (client is ready + wheatley has set up)
    ready = false;

    // Application ID, must be provided in auth.json
    readonly id: string;
    // Guild ID, falls back onto TCCPP if not provided in auth.json.
    readonly guildId: string;
    // True if freestanding mode is enabled. Defaults to false.
    readonly freestanding: boolean;

    constructor(readonly client: Discord.Client, readonly database: DatabaseInterface, auth: authentication) {
        super();

        this.id = auth.id;
        this.freestanding = auth.freestanding ?? false;
        this.guildId = auth.guild ?? TCCPP_ID;

        this.guild_command_manager = new GuildCommandManager(this);
        this.tracker = new MemberTracker(this);

        // Every module sets a lot of listeners. This is not a leak.
        this.client.setMaxListeners(35);
        this.setMaxListeners(35);

        this.client.on("error", error => {
            M.error(error);
        });

        this.setup(auth.token).catch(critical_error);
    }

    async setup(token: string) {
        this.client.on("ready", async () => {
            if (!this.freestanding) {
                await this.fetch_guild_info();
            }
            this.emit("wheatley_ready");
            this.ready = true;
            this.client.on("messageCreate", this.on_message.bind(this));
            this.client.on("interactionCreate", this.on_interaction.bind(this));
            this.client.on("messageDelete", this.on_message_delete.bind(this));
            this.client.on("messageUpdate", this.on_message_update.bind(this));
            if (!this.freestanding) {
                await this.populate_caches();
            }
        });

        for(const file of await fs.readdir("src/components")) {
            await this.add_component((await import(`./components/${file.replace(".ts", ".js")}`)).default);
        }

        if(await directory_exists("src/private-components")) {
            for(const file of await fs.readdir("src/private-components")) {
                const component = await this.add_component(
                    (await import(`./components/${file.replace(".ts", ".js")}`)).default
                );
                if(file.endsWith("link-blacklist.ts")) {
                    this.link_blacklist = component;
                }
            }
        }

        await this.guild_command_manager.finalize(token);

        M.debug("Logging in");

        await this.client.login(token);
    }

    async fetch_guild_info() {
        // fetch list of roots and mods, replace hard-coded list
        await fetch_root_mod_list(this.client);

        // TODO: Log everything?
        const promises = [
            (async () => {
                this.action_log_channel = await fetch_text_channel(action_log_channel_id);
            })(),
            (async () => {
                this.staff_flag_log = await fetch_text_channel(staff_flag_log_id);
            })(),
            (async () => {
                this.staff_message_log = await fetch_text_channel(message_log_channel_id);
            })(),
            (async () => {
                this.TCCPP = await this.client.guilds.fetch(TCCPP_ID);
            })(),
            (async () => {
                this.cpp_help = await fetch_forum_channel(cpp_help_id);
            })(),
            (async () => {
                this.c_help = await fetch_forum_channel(c_help_id);
            })(),
            (async () => {
                this.zelis = await this.client.users.fetch(zelis_id);
            })(),
            (async () => {
                this.rules_channel = await fetch_text_channel(rules_channel_id);
            })(),
            (async () => {
                this.mods_channel = await fetch_text_channel(mods_channel_id);
                this.skill_role_suggestion_log = await fetch_text_channel(skill_role_suggestion_log_id);
            })(),
            (async () => {
                this.staff_member_log_channel = await fetch_text_channel(member_log_channel_id);
            })(),
            (async () => {
                this.welcome_channel = await fetch_text_channel(welcome_channel_id);
            })(),
            (async () => {
                this.bot_spam = await fetch_text_channel(bot_spam_id);
            })(),
            (async () => {
                this.server_suggestions_channel = await fetch_text_channel(server_suggestions_channel_id);
                this.suggestion_dashboard_thread =
                    await fetch_thread_channel(this.server_suggestions_channel, suggestion_dashboard_thread_id);
                this.suggestion_action_log_thread =
                    await fetch_thread_channel(this.server_suggestions_channel, suggestion_action_log_thread_id);
            })(),
            (async () => {
                this.the_button_channel = await fetch_text_channel(the_button_channel_id);
            })(),
            (async () => {
                this.starboard_channel = await fetch_text_channel(starboard_channel_id);
            })(),
            (async () => {
                this.staff_action_log_channel = await fetch_text_channel(staff_action_log_channel_id);
            })()
        ];
        await Promise.all(promises);
    }

    destroy() {
        this.client.destroy();
        this.text_command_map.destroy();
        this.deletable_map.destroy();
        this.tracker.destroy();
        for(const component of this.components) {
            component.destroy();
        }
    }

    async add_component<T extends BotComponent>(component: { new(w: Wheatley): T; get is_freestanding(): boolean; }) {
        if(!this.freestanding || component.is_freestanding) {
            M.log(`Initializing ${component.name}`);
            const instance = new component(this);
            try {
                await instance.setup();
            } catch(e) {
                critical_error(e);
            }
            this.components.push(instance);
            return instance;
        } else {
            return null;
        }
    }

    async populate_caches() {
        // Load a couple hundred messages for every channel we're in
        const channels: Record<string, {channel: Discord.TextBasedChannel, last_seen: number, done: boolean}> = {};
        for(const [ _, channel ] of await this.TCCPP.channels.fetch()) {
            if(channel?.isTextBased() && !channel.name.includes("archived-")) {
                M.debug(`Loading recent messages from ${channel.name}`);
                //await channel.messages.fetch({
                //    limit: 100,
                //    cache: true
                //});
                channels[channel.id] = {
                    channel,
                    last_seen: Date.now(),
                    done: false
                };
            }
        }
        for(let i = 0; i < 3; i++) {
            M.log("Fetches round", i);
            const promises: Promise<any>[] = [];
            for(const [ id, { channel, last_seen, done }] of Object.entries(channels)) {
                if(!done) {
                    promises.push((async () => {
                        const messages = await channel.messages.fetch({
                            limit: 100,
                            cache: true,
                            before: forge_snowflake(last_seen - 1)
                        });
                        channels[id].last_seen = Math.min(
                            ...[...messages.values()].map(message => message.createdTimestamp)
                        );
                        if(messages.size == 0) {
                            channels[id].done = true;
                        }
                    })());
                }
            }
            await Promise.all(promises);
        }
    }

    // command edit/deletion

    register_text_command(trigger: Discord.Message, command: TextBasedCommand, deletable = true) {
        this.text_command_map.set(trigger.id, { command, deletable });
    }

    make_deletable(trigger: Discord.Message, message: Discord.Message) {
        this.deletable_map.set(trigger.id, message);
    }

    // command stuff

    add_command<T extends unknown[]>(
        command: TextBasedCommandBuilder<T, true, true> | MessageContextMenuCommandBuilder<true> | ModalHandler<true>
    ) {
        if(command instanceof TextBasedCommandBuilder) {
            assert(command.names.length > 0);
            assert(command.names.length == command.descriptions.length);
            for(const [ name, description, slash ] of zip(command.names, command.descriptions, command.slash_config)) {
                assert(!(name in this.text_commands));
                this.text_commands[name] = new BotTextBasedCommand(
                    name,
                    description,
                    slash,
                    command.permissions,
                    command
                );
                if(slash) {
                    const djs_command = new Discord.SlashCommandBuilder()
                        .setName(name)
                        .setDescription(description);
                    for(const option of command.options.values()) {
                        // NOTE: Temp for now
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if(option.type == "string") {
                            djs_command.addStringOption(slash_option =>
                                slash_option.setName(option.title)
                                    .setDescription(option.description)
                                    .setAutocomplete(!!option.autocomplete)
                                    .setRequired(!!option.required));
                        } else {
                            assert(false, "unhandled option type");
                        }
                    }
                    if(command.permissions !== undefined) {
                        djs_command.setDefaultMemberPermissions(command.permissions);
                    }
                    this.guild_command_manager.register(djs_command);
                }
            }
        } else {
            assert(!(command.name in this.other_commands));
            const [ bot_command, djs_command ] = command.to_command_descriptors();
            this.other_commands[command.name] = bot_command;
            if(djs_command) {
                this.guild_command_manager.register(djs_command);
            }
        }
    }

    static command_regex = new RegExp("^!(\\S+)");

    async handle_command(message: Discord.Message, prev_command_obj?: TextBasedCommand) {
        const match = message.content.match(Wheatley.command_regex);
        if(match) {
            const command_name = match[1];
            if(command_name in this.text_commands) {
                const command = this.text_commands[command_name];
                const command_options: unknown[] = [];
                const command_obj = prev_command_obj ? new TextBasedCommand(
                    prev_command_obj,
                    command_name,
                    message
                ) : new TextBasedCommand(
                    command_name,
                    message,
                    this
                );
                this.register_text_command(message, command_obj);
                if(command.permissions !== undefined) {
                    if(!(await command_obj.get_member()).permissions.has(command.permissions)) {
                        await command_obj.reply({
                            embeds: [
                                create_basic_embed(
                                    undefined, colors.red, "Invalid permissions"
                                )
                            ],
                            should_text_reply: true
                        });
                        return;
                    }
                }
                // TODO: Handle unexpected input?
                // NOTE: For now only able to take text input
                assert(
                    [...command.options.values()].every(option => option.type as any == "string"),
                    "unhandled option type"
                );
                const parts = string_split(
                    message.content.substring(match[0].length).trim(),
                    " ",
                    command.options.size
                );
                for(const [ i, option ] of [...command.options.values()].entries()) {
                    if(i >= parts.length && option.required) {
                        await command_obj.reply({
                            embeds: [
                                create_basic_embed(
                                    undefined, colors.red, `Required argument "${option.title}" not found`
                                )
                            ]
                        });
                        return;
                    }
                    command_options.push(parts[i]);
                }
                /*for(const option of command.options.values()) {
                    // NOTE: Temp for now
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if(option.type == "string") {
                        // take the rest
                        const rest = message.content.substring(match[0].length).trim();
                        if(rest == "" && option.required) {
                            await command_obj.reply({
                                embeds: [
                                    create_basic_embed(
                                        undefined, colors.red, `Required argument "${option.title}" not found`
                                    )
                                ]
                            });
                            return;
                        }
                        command_options.push(rest);
                    } else {
                        assert(false, "unhandled option type");
                    }
                }*/
                await command.handler(command_obj, ...command_options);
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

    async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        try {
            if(this.text_command_map.has(message.id)) {
                const { command, deletable } = this.text_command_map.get(message.id)!;
                this.text_command_map.remove(message.id);
                if(deletable) {
                    await command.delete_replies_if_replied();
                }
            } else if(this.deletable_map.has(message.id)) {
                const target = this.deletable_map.get(message.id)!;
                this.deletable_map.remove(message.id);
                try {
                    await target.delete();
                } catch(e) {
                    if(e instanceof Discord.DiscordAPIError && e.code == 10008) {
                        // pass, ignore - response deleted before trigger
                    } else {
                        throw e;
                    }
                }
            }
        } catch(e) {
            // TODO....
            critical_error(e);
        }
    }

    async on_message_update(old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage) {
        try {
            if(this.text_command_map.has(new_message.id)) {
                const { command } = this.text_command_map.get(new_message.id)!;
                command.set_editing();
                const message = !new_message.partial ? new_message : await new_message.fetch();
                if(!await this.handle_command(message, command)) {
                    // returns false if the message was not a wheatley command; delete replies and remove from map
                    await command.delete_replies_if_replied();
                    this.text_command_map.remove(new_message.id);
                }
            }
        } catch(e) {
            // TODO....
            critical_error(e);
        }
    }

    // TODO: Notify about critical errors.....
    async on_message(message: Discord.Message) {
        try {
            if(message.author.bot) return; // skip bots
            if(message.content.startsWith("!")) {
                await this.handle_command(message);
            }
        } catch(e) {
            // TODO....
            critical_error(e);
        }
    }

    async on_interaction(interaction: Discord.Interaction) {
        try {
            if(interaction.isChatInputCommand()) {
                if(interaction.commandName in this.text_commands) {
                    const command = this.text_commands[interaction.commandName];
                    const command_options: unknown[] = [];
                    const command_object = new TextBasedCommand(
                        interaction.commandName,
                        interaction,
                        this
                    );
                    if(command.permissions !== undefined) {
                        assert((await command_object.get_member()).permissions.has(command.permissions));
                    }
                    for(const option of command.options.values()) {
                        // NOTE: Temp for now
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        if(option.type == "string") {
                            const option_value = interaction.options.getString(option.title);
                            if(!option_value && option.required) {
                                await command_object.reply({
                                    embeds: [
                                        create_basic_embed(undefined, colors.red, "Required argument not found")
                                    ],
                                    ephemeral_if_possible: true
                                });
                                critical_error("this shouldn't happen");
                                return;
                            }
                            command_options.push(option_value ?? "");
                        } else {
                            assert(false, "unhandled option type");
                        }
                    }
                    await command.handler(command_object, ...command_options);
                } else {
                    // TODO unknown command
                }
            } else if(interaction.isAutocomplete()) {
                if(interaction.commandName in this.text_commands) {
                    const command = this.text_commands[interaction.commandName];
                    // TODO: permissions sanity check?
                    const field = interaction.options.getFocused(true);
                    assert(command.options.has(field.name));
                    const option = command.options.get(field.name)!;
                    assert(option.autocomplete);
                    await interaction.respond(
                        option.autocomplete(field.value, interaction.commandName)
                            .map(({ name, value }) => ({
                                name: name.substring(0, 100),
                                value: value.substring(0, 100)
                            }))
                    );
                } else {
                    // TODO unknown command
                }
            } else if(interaction.isMessageContextMenuCommand()) {
                assert(interaction.commandName in this.other_commands);
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if(interaction.isUserContextMenuCommand()) {
                assert(interaction.commandName in this.other_commands);
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if(interaction.isModalSubmit()) {
                const [ command_name, id ] = interaction.customId.split("--") as [string, string | undefined];
                // TODO: Can't assert atm
                if(command_name in this.other_commands) {
                    const command = this.other_commands[command_name] as BotModalHandler;
                    const fields = command.fields.map(id => interaction.fields.getTextInputValue(id));
                    await command.handler(interaction, ...(id ? [ id, ...fields ] : fields));
                }
            }
            // TODO: Notify if errors occur in the handler....
        } catch(e) {
            // TODO....
            critical_error(e);
        }
    }
}
