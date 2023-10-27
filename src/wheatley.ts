import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { EventEmitter } from "events";

import { colors, MINUTE } from "./common.js";
import { unwrap } from "./utils/misc.js";
import { is_string } from "./utils/strings.js";
import { directory_exists } from "./utils/filesystem.js";
import { walk_dir } from "./utils/filesystem.js";
import { critical_error } from "./utils/debugging-and-logging.js";
import { SelfClearingMap } from "./utils/containers.js";
import { M } from "./utils/debugging-and-logging.js";
import { BotComponent } from "./bot-component.js";

import { MessageContextMenuInteractionBuilder } from "./command-abstractions/context-menu.js";
import { BotModalHandler, ModalInteractionBuilder } from "./command-abstractions/modal.js";
import { TextBasedCommandBuilder } from "./command-abstractions/text-based-command-builder.js";
import { BotTextBasedCommand } from "./command-abstractions/text-based-command-descriptor.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "./command-abstractions/text-based-command.js";
import { BaseBotInteraction } from "./command-abstractions/interaction-base.js";

import { WheatleyDatabase, WheatleyDatabaseProxy } from "./infra/database-interface.js";
import { GuildCommandManager } from "./infra/guild-command-manager.js";
import { MemberTracker } from "./infra/member-tracker.js";
import { forge_snowflake } from "./components/snowflake.js";

export function create_basic_embed(title: string | undefined, color: number, content: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(content);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

export function create_error_reply(message: string): Discord.BaseMessageOptions & CommandAbstractionReplyOptions {
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
    sentry?: string;
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

const TCCPP_ID = "331718482485837825";
export const zelis_id = "199943082441965577";

const tuple = <T extends any[]>(...args: T): T => args;

const channels_map = {
    // staff
    staff_flag_log: tuple("1026972603019169842", Discord.TextChannel),
    staff_action_log: tuple("845290775692443699", Discord.TextChannel),
    welcome: tuple("778017793567490078", Discord.TextChannel),
    staff_member_log: tuple("875681819662622730", Discord.TextChannel),
    staff_message_log: tuple("467729928956411914", Discord.TextChannel),
    staff_only: tuple("342153262260289537", Discord.TextChannel),
    mods: tuple("847993258600038460", Discord.TextChannel),
    // meta
    rules: tuple("659868782877212723", Discord.TextChannel),
    announcements: tuple("331881381477089282", Discord.NewsChannel),
    server_suggestions: tuple("802541516655951892", Discord.TextChannel),
    skill_role_suggestion_log: tuple("1099193160858599484", Discord.TextChannel),
    resources: tuple("1124619767542718524", Discord.ForumChannel),
    // language channels
    cpp_help: tuple("1013107104678162544", Discord.ForumChannel),
    c_help: tuple("1013104018739974194", Discord.ForumChannel),
    cpp_help_text: tuple("331718580070645760", Discord.TextChannel),
    c_help_text: tuple("331718539738087426", Discord.TextChannel),
    c_cpp_discussion: tuple("851121440425639956", Discord.TextChannel),
    general_discussion: tuple("855220264149057556", Discord.TextChannel),
    // off-topic
    starboard: tuple("800509841424252968", Discord.TextChannel),
    memes: tuple("526518219549442071", Discord.TextChannel),
    // other
    bot_spam: tuple("506274405500977153", Discord.TextChannel),
    the_button: tuple("1069678919667687455", Discord.TextChannel),
    introductions: tuple("933113495304679494", Discord.TextChannel),
    suggestion_dashboard: tuple("908928083879415839", Discord.ThreadChannel),
    suggestion_action_log: tuple("909309608512880681", Discord.ThreadChannel),
    today_i_learned: tuple("873682069325217802", Discord.TextChannel),
    // red telephone
    red_telephone_alerts: tuple("1140096352278290512", Discord.TextChannel),
};

const roles_map = {
    muted: "815987333094178825",
    monke: "1139378060450332752",
    no_off_topic: "879419994004422666",
    no_suggestions: "831567015457980447",
    no_suggestions_at_all: "895011256023535657",
    no_reactions: "880152014036819968",
    no_threads: "870181444742447135",
    no_serious_off_topic: "921116034948272260",
    no_til: "883474632370454588",
    no_memes: "982307359370141756",
    moderators: "847915341954154536",
    root: "331719468440879105",
    pink: "888158339878490132",
};

const skill_roles_map = {
    intermediate: "331876085820030978",
    proficient: "849399021838925834",
    advanced: "331719590990184450",
    expert: "331719591405551616",
    beginner: "784733371275673600",
};

// General config
// TODO: Can eliminate this stuff
export const root_ids = new Set([
    "199943082441965577", // zelis
    "110756651694297088", // vincent
    "89441674844995584", // styx
    // prevent Wheatley reactions being removed in server suggestions and also allow some elegant handling
    "313597351262683138", // dot
    "597216680271282192", // wheatley
]);

export const root_mod_ids = [
    "199943082441965577", // zelis
    "230282234085638155", // cas
    "310536456647081985", // lumi
    "719255892813545502", // sampersand
    "89441674844995584", // styx
    "110756651694297088", // vincent
    "138014214093668353", // dxpower
    "313597351262683138", // dot
    "413463039145410560", // karnage
    "512649489300062228", // quicknir
    "446584068746772480", // yinsei
];

export const root_mod_ids_set = new Set(root_mod_ids);

export class Wheatley extends EventEmitter {
    components = new Map<string, BotComponent>();
    readonly guild_command_manager: GuildCommandManager;
    readonly tracker: MemberTracker; // TODO: Rename

    database: WheatleyDatabaseProxy;

    link_blacklist: any;

    text_commands: Record<string, BotTextBasedCommand<unknown[]>> = {};
    other_commands: Record<string, BaseBotInteraction<unknown[]>> = {};

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

    // Some emojis
    readonly pepereally = "<:pepereally:643881257624666112>";
    readonly stackoverflow_emote = "<:stackoverflow:1074747016644661258>";
    readonly microsoft_emote = "<:microsoft:1165512917047853127>";
    readonly tux_emote = "<:tux:1165505626894520361>";
    readonly apple_emote = "<:apple:1165508607798943754>";

    // TCCPP stuff
    TCCPP: Discord.Guild;
    zelis: Discord.User;

    channels: {
        // ["prototype"] gets the instance type, eliminating the `typeof`. InstanceType<T> doesn't work for a protected
        // constructor, weirdly.
        [k in keyof typeof channels_map]: (typeof channels_map)[k][1]["prototype"];
    } = {} as any;

    thread_based_channel_ids = new Set([
        "802541516655951892", // server-suggestions
        "594212045621035030", // showcase
        "873682069325217802", // today-i-learned
    ]);

    roles: {
        [k in keyof typeof roles_map]: Discord.Role;
    } = {} as any;
    skill_roles: {
        [k in keyof typeof skill_roles_map]: Discord.Role;
    } = {} as any;

    // TODO: Eliminate pre-set value
    root_mod_list = "jr-#6677, Eisenwave#7675, Styxs#7557, or Vin¢#1293";

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
        assert(this.freestanding || auth.mongo, "Missing MongoDB credentials");
        if (auth.mongo) {
            this.database = await WheatleyDatabase.create(auth.mongo);
        }

        this.client.on("ready", async () => {
            await this.fetch_guild_info();

            for (const component of this.components.values()) {
                try {
                    await component.setup();
                } catch (e) {
                    critical_error(e);
                }
            }
            await this.guild_command_manager.finalize(auth.token);
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

        M.debug("Logging in");

        await this.client.login(auth.token);
    }

    async fetch_guild_info() {
        const wrap = async <T>(fn: () => Promise<T>): Promise<T | null> => {
            try {
                return await fn();
            } catch (e) {
                if (!this.freestanding) {
                    critical_error(e);
                    throw e;
                } else {
                    // absorb error
                    return null;
                }
            }
        };
        const fudged_unwrap = <T>(value: T | null | undefined): T => {
            if (!this.freestanding) {
                // for the real bot actually check
                return unwrap(value);
            } else {
                return value as T;
            }
        };
        // Preliminary loads
        this.TCCPP = fudged_unwrap(await wrap(() => this.client.guilds.fetch(this.guildId)));
        this.zelis = fudged_unwrap(await wrap(() => this.client.users.fetch(zelis_id)));
        // Channels
        await Promise.all(
            Object.entries(channels_map).map(async ([k, [id, type]]) => {
                const channel = await wrap(() => this.client.channels.fetch(id));
                if (this.freestanding && channel === null) {
                    return;
                }
                assert(channel !== null, `Channel ${k} ${id} not found`);
                assert(channel instanceof type, `Channel ${k} ${id} not of the expected type`);
                this.channels[k as keyof typeof channels_map] = channel as any;
                M.log(`Fetched channel ${k}`);
            }),
        );
        // Roles
        await Promise.all(
            Object.entries(roles_map).map(async ([k, id]) => {
                const role = await wrap(() => this.TCCPP.roles.fetch(id));
                if (this.freestanding && role === null) {
                    return;
                }
                assert(role !== null, `Role ${k} ${id} not found`);
                this.roles[k as keyof typeof roles_map] = role;
                M.log(`Fetched role ${k}`);
            }),
        );
        await Promise.all(
            Object.entries(skill_roles_map).map(async ([k, id]) => {
                const role = await wrap(() => this.TCCPP.roles.fetch(id));
                if (this.freestanding && role === null) {
                    return;
                }
                assert(role !== null, `Role ${k} ${id} not found`);
                this.skill_roles[k as keyof typeof skill_roles_map] = role;
                M.log(`Fetched role ${k}`);
            }),
        );
        // fetch list of roots and mods, replace hard-coded list
        await wrap(() => this.fetch_root_mod_list(this.client));
    }

    async add_component<T extends BotComponent>(component: { new (w: Wheatley): T; get is_freestanding(): boolean }) {
        if (!this.freestanding || component.is_freestanding) {
            M.log(`Initializing ${component.name}`);
            assert(!this.components.has(component.name), "Duplicate component name");
            const instance = new component(this);
            this.components.set(component.name, instance);
            return instance;
        } else {
            return null;
        }
    }

    is_forum_help_thread(thread: Discord.ThreadChannel) {
        return (
            thread.parentId != null && [this.channels.cpp_help.id, this.channels.c_help.id].includes(thread.parentId)
        );
    }

    // utility: returns the channel for regular channels or the thread / forum post parent
    top_level_channel(channel: Discord.TextBasedChannel) {
        if (channel instanceof Discord.ThreadChannel && channel.parentId != null) {
            return channel.parentId;
        } else {
            return channel.id;
        }
    }

    async fetch_message_reply(message: Discord.Message) {
        const ref = unwrap(message.reference);
        assert(ref.guildId === message.guildId);
        assert(ref.channelId === message.channelId);
        const channel = unwrap(await this.client.channels.fetch(ref.channelId));
        assert(channel.isTextBased());
        const reply_message = await channel.messages.fetch(unwrap(ref.messageId));
        return reply_message;
    }

    // Some common tools
    is_root(user: Discord.User | Discord.PartialUser | Discord.APIUser): boolean {
        //return member.roles.cache.some(r => r.id == root_role_id);
        return root_ids.has(user.id);
    }

    is_authorized_mod(member: Discord.GuildMember | Discord.User | string): boolean {
        if (is_string(member)) {
            return root_mod_ids_set.has(member);
        } else {
            return root_mod_ids_set.has(member.id);
        }
    }

    has_skill_roles_other_than_beginner(member: Discord.GuildMember) {
        const non_beginner_skill_role_ids = Object.entries(this.skill_roles)
            .filter(([name, _]) => name !== "beginner")
            .map(([_, role]) => role.id);
        return member.roles.cache.some(role => non_beginner_skill_role_ids.includes(role.id));
    }

    async fetch_root_mod_list(client: Discord.Client) {
        const tags = [];
        for (const id of root_mod_ids) {
            tags.push((await client.users.fetch(id)).tag);
        }
        assert(tags.length > 3);
        this.root_mod_list = tags.slice(0, tags.length - 1).join(", ") + ", or " + tags[tags.length - 1];
        M.debug("root_mod_list", [this.root_mod_list]);
    }

    // case-insensitive
    get_role_by_name(name: string) {
        return unwrap(this.TCCPP.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase()));
    }

    async try_fetch_member(options: Discord.UserResolvable | Discord.FetchMemberOptions) {
        try {
            return await this.TCCPP.members.fetch(options);
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 10007) {
                return null;
            } else {
                throw e;
            }
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
        command:
            | TextBasedCommandBuilder<T, true, true>
            | TextBasedCommandBuilder<T, true, false, true>
            | MessageContextMenuInteractionBuilder<true>
            | ModalInteractionBuilder<true>,
    ) {
        if (command instanceof TextBasedCommandBuilder) {
            for (const descriptor of command.to_command_descriptors(this)) {
                assert(!(descriptor.name in this.text_commands));
                this.text_commands[descriptor.name] = descriptor;
                if (descriptor.slash) {
                    this.guild_command_manager.register(descriptor.to_slash_command(new Discord.SlashCommandBuilder()));
                }
            }
        } else {
            assert(!(command.name in this.other_commands));
            const [bot_command, djs_command] = command.to_command_descriptors();
            this.other_commands[command.name] = bot_command as BaseBotInteraction<unknown[]>;
            if (djs_command) {
                this.guild_command_manager.register(djs_command);
            }
        }
    }

    static command_regex = new RegExp("^!(\\S+)");

    // returns false if the message was not a wheatley command
    async handle_command(message: Discord.Message, prev_command_obj?: TextBasedCommand) {
        const match = message.content.match(Wheatley.command_regex);
        if (match) {
            const command_name = match[1];
            if (command_name in this.text_commands) {
                let command_body = message.content.substring(match[0].length).trim();
                let command = this.text_commands[command_name];
                const command_obj = prev_command_obj
                    ? new TextBasedCommand(prev_command_obj, command_name, command, message)
                    : new TextBasedCommand(command_name, command, message, this);
                this.register_text_command(message, command_obj);
                if (command.subcommands) {
                    // expect a subcommand argument
                    const re = /^\S+/;
                    const match = command_body.match(re);
                    const subcommand = match ? command.subcommands.get(match[0]) : undefined;
                    if (subcommand) {
                        command = unwrap(subcommand);
                        command_body = command_body.slice(unwrap(match)[0].length).trim();
                        command_obj.command_descriptor = command;
                    } else {
                        await command_obj.reply({ embeds: [command.command_info_and_description_embed()] });
                        return;
                    }
                }
                if (command.permissions !== undefined) {
                    if (!(await command_obj.get_member()).permissions.has(command.permissions)) {
                        await command_obj.reply(create_error_reply("Invalid permissions"));
                        return;
                    }
                }
                const command_options = await command.parse_text_arguments(command_obj, message, command_body);
                if (command_options !== undefined) {
                    await command.handler(command_obj, ...command_options);
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
                    let command = this.text_commands[interaction.commandName];
                    if (interaction.options.getSubcommand(false)) {
                        command = unwrap(unwrap(command.subcommands).get(interaction.options.getSubcommand()));
                    }
                    const command_options: unknown[] = [];
                    const command_object = new TextBasedCommand(interaction.commandName, command, interaction, this);
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
                            command_options.push(option_value);
                        } else if (option.type == "user") {
                            command_options.push(interaction.options.getUser(option.title));
                        } else if (option.type == "role") {
                            command_options.push(interaction.options.getRole(option.title));
                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                        } else if (option.type == "number") {
                            command_options.push(interaction.options.getNumber(option.title));
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
