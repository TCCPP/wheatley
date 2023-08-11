import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { EventEmitter } from "events";
import * as fs from "fs/promises";

import {
    action_log_channel_id,
    bot_spam_id,
    colors,
    cpp_help_id,
    c_help_id,
    member_log_channel_id,
    message_log_channel_id,
    MINUTE,
    mods_channel_id,
    rules_channel_id,
    server_suggestions_channel_id,
    staff_flag_log_id,
    suggestion_action_log_thread_id,
    suggestion_dashboard_thread_id,
    TCCPP_ID,
    welcome_channel_id,
    zelis_id,
    the_button_channel_id,
    skill_role_suggestion_log_id,
    starboard_channel_id,
    staff_action_log_channel_id,
    fetch_root_mod_list,
} from "./common.js";
import {
    critical_error,
    fetch_forum_channel,
    fetch_text_channel,
    fetch_thread_channel,
    M,
    directory_exists,
    SelfClearingMap,
    string_split,
    zip,
    walk_dir,
    unwrap,
} from "./utils.js";
import { BotComponent } from "./bot-component.js";
import {
    BotCommand,
    BotModalHandler,
    BotTextBasedCommand,
    CommandAbstractionReplyOptions,
    MessageContextMenuCommandBuilder,
    ModalHandler,
    TextBasedCommand,
    TextBasedCommandBuilder,
} from "./command.js";

import { WheatleyDatabase, WheatleyDatabaseProxy } from "./infra/database-interface.js";
import { GuildCommandManager } from "./infra/guild-command-manager.js";
import { MemberTracker } from "./infra/member-tracker.js";

import { forge_snowflake } from "./components/snowflake.js";

function create_basic_embed(title: string | undefined, color: number, content: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(content);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

function create_error_reply(message: string): Discord.BaseMessageOptions & CommandAbstractionReplyOptions {
    return {
        embeds: [create_basic_embed(undefined, colors.red, message)],
        should_text_reply: true,
    };
}

type text_command_map_target = {
    command: TextBasedCommand;
    deletable: boolean;
};

export type wheatley_database_credentials = {
    user: string;
    password: string;
};

export type wheatley_auth = {
    id: string;
    guild?: string;
    token: string;
    freestanding?: boolean;
    mongo?: wheatley_database_credentials;
};

export type wheatley_database_info = {
    id: string;
    server_suggestions: {
        last_scanned_timestamp: number;
    };
    modmail_id_counter: number;
    the_button: {
        button_presses: number;
        last_reset: number;
        longest_time_without_reset: number;
    };
    starboard: {
        delete_emojis: string[];
        ignored_emojis: string[];
        negative_emojis: string[];
    };
    moderation_case_number: number;
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
    muted_role: Discord.Role;

    database: WheatleyDatabaseProxy;

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

    constructor(
        readonly client: Discord.Client,
        auth: wheatley_auth,
    ) {
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

        this.setup(auth).catch(critical_error);
    }

    async setup(auth: wheatley_auth) {
        if (!auth.freestanding) {
            // TODO handle non-freestanding case where no credentials were
            //      were provided, disabling database features.
            //      This probably requires adding a bool method to each
            //      component that uses the database, and not loading them.
            assert(auth.mongo, "Missing MongoDB credentials");
            this.database = await WheatleyDatabase.create(auth.mongo);
        }

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

        for await (const file of walk_dir("src/components")) {
            const default_export = (await import(`../${file.replace(".ts", ".js")}`)).default;
            if (default_export !== undefined) {
                await this.add_component(default_export);
            }
        }

        if (await directory_exists("src/wheatley-private/components")) {
            for await (const file of walk_dir("src/wheatley-private/components")) {
                const default_export = (await import(`../${file.replace(".ts", ".js")}`)).default;
                if (default_export !== undefined) {
                    const component = await this.add_component(default_export);
                    if (file.endsWith("link-blacklist.ts")) {
                        this.link_blacklist = component;
                    }
                }
            }
        }

        await this.guild_command_manager.finalize(auth.token);

        M.debug("Logging in");

        await this.client.login(auth.token);
    }

    async fetch_guild_info() {
        // fetch list of roots and mods, replace hard-coded list
        await fetch_root_mod_list(this.client);

        // TODO: Log everything?
        const promises = [
            async () => {
                this.action_log_channel = await fetch_text_channel(action_log_channel_id);
            },
            async () => {
                this.staff_flag_log = await fetch_text_channel(staff_flag_log_id);
            },
            async () => {
                this.staff_message_log = await fetch_text_channel(message_log_channel_id);
            },
            async () => {
                this.TCCPP = await this.client.guilds.fetch(TCCPP_ID);
                this.muted_role = unwrap(this.TCCPP.roles.cache.find(role => role.name === "Muted"));
            },
            async () => {
                this.cpp_help = await fetch_forum_channel(cpp_help_id);
            },
            async () => {
                this.c_help = await fetch_forum_channel(c_help_id);
            },
            async () => {
                this.zelis = await this.client.users.fetch(zelis_id);
            },
            async () => {
                this.rules_channel = await fetch_text_channel(rules_channel_id);
            },
            async () => {
                this.mods_channel = await fetch_text_channel(mods_channel_id);
                this.skill_role_suggestion_log = await fetch_text_channel(skill_role_suggestion_log_id);
            },
            async () => {
                this.staff_member_log_channel = await fetch_text_channel(member_log_channel_id);
            },
            async () => {
                this.welcome_channel = await fetch_text_channel(welcome_channel_id);
            },
            async () => {
                this.bot_spam = await fetch_text_channel(bot_spam_id);
            },
            async () => {
                this.server_suggestions_channel = await fetch_text_channel(server_suggestions_channel_id);
                this.suggestion_dashboard_thread = await fetch_thread_channel(
                    this.server_suggestions_channel,
                    suggestion_dashboard_thread_id,
                );
                this.suggestion_action_log_thread = await fetch_thread_channel(
                    this.server_suggestions_channel,
                    suggestion_action_log_thread_id,
                );
            },
            async () => {
                this.the_button_channel = await fetch_text_channel(the_button_channel_id);
            },
            async () => {
                this.starboard_channel = await fetch_text_channel(starboard_channel_id);
            },
            async () => {
                this.staff_action_log_channel = await fetch_text_channel(staff_action_log_channel_id);
            },
        ];
        await Promise.all(promises.map(action => action()));
    }

    destroy() {
        this.database.close().catch(critical_error);
        for (const component of this.components) {
            component.destroy();
        }
        this.text_command_map.destroy();
        this.deletable_map.destroy();
        this.tracker.destroy();
        this.client.destroy().catch(critical_error);
    }

    async add_component<T extends BotComponent>(component: { new (w: Wheatley): T; get is_freestanding(): boolean }) {
        if (!this.freestanding || component.is_freestanding) {
            M.log(`Initializing ${component.name}`);
            const instance = new component(this);
            try {
                await instance.setup();
            } catch (e) {
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
        const channels: Record<string, { channel: Discord.TextBasedChannel; last_seen: number; done: boolean }> = {};
        for (const [_, channel] of await this.TCCPP.channels.fetch()) {
            if (channel?.isTextBased() && !channel.name.includes("archived-")) {
                M.debug(`Loading recent messages from ${channel.name}`);
                //await channel.messages.fetch({
                //    limit: 100,
                //    cache: true
                //});
                channels[channel.id] = {
                    channel,
                    last_seen: Date.now(),
                    done: false,
                };
            }
        }
        for (let i = 0; i < 3; i++) {
            M.log("Fetches round", i);
            const promises: Promise<any>[] = [];
            for (const [id, { channel, last_seen, done }] of Object.entries(channels)) {
                if (!done) {
                    promises.push(
                        (async () => {
                            const messages = await channel.messages.fetch({
                                limit: 100,
                                cache: true,
                                before: forge_snowflake(last_seen - 1),
                            });
                            channels[id].last_seen = Math.min(
                                ...[...messages.values()].map(message => message.createdTimestamp),
                            );
                            if (messages.size == 0) {
                                channels[id].done = true;
                            }
                        })(),
                    );
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
        command: TextBasedCommandBuilder<T, true, true> | MessageContextMenuCommandBuilder<true> | ModalHandler<true>,
    ) {
        if (command instanceof TextBasedCommandBuilder) {
            assert(command.names.length > 0);
            assert(command.names.length == command.descriptions.length);
            for (const [name, description, slash] of zip(command.names, command.descriptions, command.slash_config)) {
                assert(!(name in this.text_commands));
                this.text_commands[name] = new BotTextBasedCommand(
                    name,
                    description,
                    slash,
                    command.permissions,
                    command,
                );
                if (slash) {
                    const djs_command = new Discord.SlashCommandBuilder().setName(name).setDescription(description);
                    for (const option of command.options.values()) {
                        // NOTE: Temp for now
                        if (option.type == "string") {
                            djs_command.addStringOption(slash_option =>
                                slash_option
                                    .setName(option.title)
                                    .setDescription(option.description)
                                    .setAutocomplete(!!option.autocomplete)
                                    .setRequired(!!option.required),
                            );
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        } else if (option.type == "user") {
                            djs_command.addUserOption(slash_option =>
                                slash_option
                                    .setName(option.title)
                                    .setDescription(option.description)
                                    .setRequired(!!option.required),
                            );
                        } else {
                            assert(false, "unhandled option type");
                        }
                    }
                    if (command.permissions !== undefined) {
                        djs_command.setDefaultMemberPermissions(command.permissions);
                    }
                    this.guild_command_manager.register(djs_command);
                }
            }
        } else {
            assert(!(command.name in this.other_commands));
            const [bot_command, djs_command] = command.to_command_descriptors();
            this.other_commands[command.name] = bot_command;
            if (djs_command) {
                this.guild_command_manager.register(djs_command);
            }
        }
    }

    static command_regex = new RegExp("^!(\\S+)");

    async handle_command(message: Discord.Message, prev_command_obj?: TextBasedCommand) {
        const match = message.content.match(Wheatley.command_regex);
        if (match) {
            const command_name = match[1];
            if (command_name in this.text_commands) {
                const command = this.text_commands[command_name];
                const command_obj = prev_command_obj
                    ? new TextBasedCommand(prev_command_obj, command_name, message)
                    : new TextBasedCommand(command_name, message, this);
                this.register_text_command(message, command_obj);
                if (command.permissions !== undefined) {
                    if (!(await command_obj.get_member()).permissions.has(command.permissions)) {
                        await command_obj.reply(create_error_reply("Invalid permissions"));
                        return;
                    }
                }
                // TODO: Handle unexpected / trailing input?
                // NOTE: For now only able to take text and user input
                // TODO: Handle `required`
                let command_body = message.content.substring(match[0].length).trim();
                const command_options: unknown[] = [];
                for (const [i, option] of [...command.options.values()].entries()) {
                    if (option.type == "string") {
                        if (option.regex) {
                            const match = command_body.match(option.regex);
                            if (match) {
                                command_options.push(match[0]);
                                command_body = command_body.slice(match[0].length).trim();
                            } else {
                                await command_obj.reply(
                                    create_error_reply(`Required argument "${option.title}" not found`),
                                );
                                return;
                            }
                        } else if (i == command.options.size - 1) {
                            if (command_body == "") {
                                await command_obj.reply(
                                    create_error_reply(`Required argument "${option.title}" not found`),
                                );
                                return;
                            } else {
                                command_options.push(command_body);
                                command_body = "";
                            }
                        } else {
                            const re = /^\S+/;
                            const match = command_body.match(re);
                            if (match) {
                                command_options.push(match[0]);
                                command_body = command_body.slice(match[0].length).trim();
                            } else {
                                await command_obj.reply(
                                    create_error_reply(`Required argument "${option.title}" not found`),
                                );
                                return;
                            }
                        }
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    } else if (option.type == "user") {
                        const re = /^(?:<@(\d{10,})>|(\d{10,}))/;
                        const match = command_body.match(re);
                        if (match) {
                            try {
                                const user = await this.client.users.fetch(match[1]);
                                command_options.push(user);
                                command_body = command_body.slice(match[0].length).trim();
                            } catch (e) {
                                await command_obj.reply(create_error_reply(`Unable to find user`));
                                return;
                            }
                        } else {
                            await command_obj.reply(
                                create_error_reply(`Required argument "${option.title}" not found`),
                            );
                            return;
                        }
                    } else {
                        assert(false, "unhandled option type");
                    }
                }
                if (command_body != "") {
                    await command_obj.reply(create_error_reply(`Unexpected parameters provided`));
                    return;
                }
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
            if (this.text_command_map.has(message.id)) {
                const { command, deletable } = this.text_command_map.get(message.id)!;
                this.text_command_map.remove(message.id);
                if (deletable) {
                    await command.delete_replies_if_replied();
                }
            } else if (this.deletable_map.has(message.id)) {
                const target = this.deletable_map.get(message.id)!;
                this.deletable_map.remove(message.id);
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
            critical_error(e);
        }
    }

    async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        try {
            if (this.text_command_map.has(new_message.id)) {
                const { command } = this.text_command_map.get(new_message.id)!;
                command.set_editing();
                const message = !new_message.partial ? new_message : await new_message.fetch();
                if (!(await this.handle_command(message, command))) {
                    // returns false if the message was not a wheatley command; delete replies and remove from map
                    await command.delete_replies_if_replied();
                    this.text_command_map.remove(new_message.id);
                }
            }
        } catch (e) {
            // TODO....
            critical_error(e);
        }
    }

    // TODO: Notify about critical errors.....
    async on_message(message: Discord.Message) {
        try {
            // skip bots
            if (message.author.bot) {
                return;
            }
            if (message.content.startsWith("!")) {
                await this.handle_command(message);
            }
        } catch (e) {
            // TODO....
            critical_error(e);
        }
    }

    async on_interaction(interaction: Discord.Interaction) {
        try {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName in this.text_commands) {
                    const command = this.text_commands[interaction.commandName];
                    const command_options: unknown[] = [];
                    const command_object = new TextBasedCommand(interaction.commandName, interaction, this);
                    if (command.permissions !== undefined) {
                        assert((await command_object.get_member()).permissions.has(command.permissions));
                    }
                    for (const option of command.options.values()) {
                        if (option.type == "string") {
                            const option_value = interaction.options.getString(option.title);
                            if (!option_value && option.required) {
                                await command_object.reply(create_error_reply("Required argument not found"), true);
                                critical_error("this shouldn't happen");
                                return;
                            }
                            if (option_value && option.regex && !option_value.trim().match(option.regex)) {
                                await command_object.reply(
                                    create_error_reply(`Argument ${option.title} doesn't match expected format`),
                                    true,
                                );
                                return;
                            }
                            command_options.push(option_value ?? "");
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        } else if (option.type == "user") {
                            command_options.push(interaction.options.getUser(option.title));
                        } else {
                            assert(false, "unhandled option type");
                        }
                    }
                    await command.handler(command_object, ...command_options);
                } else {
                    // TODO unknown command
                }
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
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if (interaction.isUserContextMenuCommand()) {
                assert(interaction.commandName in this.other_commands);
                await this.other_commands[interaction.commandName].handler(interaction);
            } else if (interaction.isModalSubmit()) {
                const [command_name, id] = interaction.customId.split("--") as [string, string | undefined];
                // TODO: Can't assert atm
                if (command_name in this.other_commands) {
                    const command = this.other_commands[command_name] as BotModalHandler;
                    const fields = command.fields.map(id => interaction.fields.getTextInputValue(id));
                    await command.handler(interaction, ...(id ? [id, ...fields] : fields));
                }
            }
            // TODO: Notify if errors occur in the handler....
        } catch (e) {
            // TODO....
            critical_error(e);
        }
    }
}
