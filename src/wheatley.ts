import { strict as assert } from "assert";
import * as Sentry from "@sentry/node";

import * as Discord from "discord.js";
import * as mongo from "mongodb";
import PromClient from "prom-client";

import { colors, MINUTE, DAY } from "./common.js";
import { wheatley_channels } from "./modules/wheatley/channels.js";
import { unwrap } from "./utils/misc.js";
import { to_string, is_string } from "./utils/strings.js";
import { globIterateSync } from "glob";
import { PathScurry } from "path-scurry";
import { M } from "./utils/debugging-and-logging.js";
import { BotComponent } from "./bot-component.js";
import { CommandAbstractionReplyOptions } from "./command-abstractions/text-based-command.js";

import { WheatleyDatabase } from "./infra/database-interface.js";
import { forge_snowflake, send_long_message_markdown_aware } from "./utils/discord.js";
import { TypedEventEmitter } from "./utils/event-emitter.js";
import { setup_metrics_server } from "./infra/prometheus.js";
import { moderation_entry } from "./modules/wheatley/components/moderation/schemata.js";
import { LoggableChannel, LogLimiter } from "./infra/log-limiter.js";
import { CommandHandler } from "./command-handler.js";
import { CommandSetBuilder } from "./command-abstractions/command-set-builder.js";
import { message_database_entry } from "./modules/wheatley/components/moderation/purge.js";

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

export type wheatley_database_credentials = {
    user: string;
    password: string;
    host?: string;
    port?: number;
};

type core_config = {
    id: string;
    guild: string;
    token: string;
    mom?: string;
    mongo?: wheatley_database_credentials;
    freestanding?: boolean;
    components?: {
        exclude?: string[];
        include?: string[];
    };
    sentry?: string;
    metrics?: {
        port: number;
        hostname: string;
    };
};

export type wheatley_config = core_config & {
    [key: string]: any;
};

type EventMap = {
    wheatley_ready: () => void;
    issue_moderation: (moderation: moderation_entry) => void;
    update_moderation: (moderation: mongo.WithId<moderation_entry>) => void;
    message_db_update: (message: message_database_entry) => void;
};

export class Wheatley {
    private discord_application!: Discord.Application | null;
    private discord_user!: Discord.User | null;
    private discord_guild!: Discord.Guild | null;
    get application() {
        return unwrap(this.discord_application);
    }
    get user() {
        return unwrap(this.discord_user);
    }
    get guild() {
        return unwrap(this.discord_guild);
    }

    readonly event_hub = new TypedEventEmitter<EventMap>();
    readonly components = new Map<string, BotComponent>();
    readonly log_limiter: LogLimiter;

    private command_handler!: CommandHandler;

    private db!: WheatleyDatabase | null;
    get database() {
        return unwrap(this.db);
    }

    // True if freestanding mode is enabled. Defaults to false.
    readonly freestanding: boolean;

    get devmode_enabled() {
        return process.env.NODE_ENV !== "production";
    }

    // Some emojis
    private emoji_map = {
        success: "✅",
        error: "❌",
        access_denied: "🙅",
        me: "🤖",
    };
    get emoji() {
        return this.emoji_map;
    }

    private log_channel: Discord.TextBasedChannel | null = null;

    message_counter = new PromClient.Counter({
        name: "tccpp_message_count",
        help: "TCCPP message count",
        labelNames: ["type"],
    });

    private mom_ping: string;

    readonly config: {
        [key: string]: any;
    };

    //
    // Bot setup
    //

    constructor(
        readonly client: Discord.Client,
        config: wheatley_config,
    ) {
        this.freestanding = config.freestanding ?? false;

        this.mom_ping = config.mom ? ` <@${config.mom}>` : "";

        this.log_limiter = new LogLimiter(this);

        // temporary until fixed in djs or @types/node
        (this.client as any).setMaxListeners(35);

        this.client.on("error", error => {
            M.error(error);
        });

        const { id, guild, token, mom, mongo, freestanding, exclude, sentry, metrics, ...component_config } = config;
        this.config = { ...component_config };

        this.setup(config).catch(this.critical_error.bind(this));
    }

    private *locate_components(config: core_config) {
        const visited = new Set<string>();

        const path_walker = new PathScurry(import.meta.dirname);

        for (const file of globIterateSync("**/components/**/*.js", {
            ignore: config.components?.exclude,
            scurry: path_walker,
            withFileTypes: true,
        })) {
            yield file.relativePosix();
            visited.add(file.fullpath());
        }

        for (const file of config.components?.include ?? []) {
            const path = path_walker.resolve(file);
            if (!visited.has(path)) {
                yield path_walker.relativePosix(file);
            }
        }
    }

    async setup(config: core_config) {
        assert(this.freestanding || config.mongo, "Missing MongoDB credentials");
        if (config.mongo) {
            this.db = await WheatleyDatabase.create(config.mongo);
            await this.migrate_db(this.database);
        }
        if (config.metrics) {
            setup_metrics_server(config.metrics.port, config.metrics.hostname);
        }

        this.client.on("ready", () => {
            M.log("Wheatley starting in the following guilds:");
            (async () => {
                await this.client.guilds.fetch();
                for (const [_, guild] of this.client.guilds.cache) {
                    M.log(guild.id, guild.name);
                }

                this.discord_application = (await this.client.application?.fetch()) ?? null;
                this.discord_user = await this.client.users.fetch(config.id);
                this.discord_guild = await this.client.guilds.fetch(config.guild);

                // Pre-fetch channels and roles so name resolution works in devmode
                await this.guild.channels.fetch().catch(this.critical_error.bind(this));
                await this.guild.roles.fetch().catch(this.critical_error.bind(this));

                if (!config.freestanding) {
                    const channel = this.client.channels.cache.get(wheatley_channels.log.id);
                    this.log_channel = channel && channel.isTextBased() ? channel : null;
                }

                this.info("Bot started");

                await this.fetch_emoji();

                const command_set_builder = new CommandSetBuilder(this);
                for (const component of this.components.values()) {
                    try {
                        await component.setup(command_set_builder);
                    } catch (e) {
                        this.critical_error(`Error setting up component ${component.constructor.name}:`, e as Error);
                    }
                }
                const { text_commands, button_handlers, modal_handlers, other_commands } =
                    await command_set_builder.finalize(config.token);
                this.command_handler = new CommandHandler(
                    this,
                    text_commands,
                    button_handlers,
                    modal_handlers,
                    other_commands,
                );

                this.event_hub.emit("wheatley_ready");
                this.client.on("messageCreate", (message: Discord.Message) => {
                    this.on_message(message).catch(this.critical_error.bind(this));
                });
                if (!this.freestanding) {
                    await this.populate_caches();
                }
            })().catch(this.critical_error.bind(this));
        });

        for (const file of this.locate_components(config)) {
            const default_export = (await import(`./${file}`)).default;
            if (default_export !== undefined) {
                await this.add_component(default_export);
            }
        }

        M.debug("Logging in");

        await this.client.login(config.token);
    }

    async fetch_emoji() {
        if (this.client.application) {
            await this.client.application.emojis.fetch();
            for (const [key, value] of this.client.application.emojis.cache) {
                this.emoji_map[value.name as keyof typeof this.emoji_map] = `<:${value.identifier}>`;
            }
        }
    }

    async add_component<T extends BotComponent>(component: { new (w: Wheatley): T; get is_freestanding(): boolean }) {
        if (!this.freestanding || component.is_freestanding) {
            M.log(`Initializing ${component.name}`);
            assert(!this.components.has(component.name), `Duplicate component name: ${component.name}`);
            const instance = new component(this);
            this.components.set(component.name, instance);
            return instance;
        } else {
            return null;
        }
    }

    async populate_caches() {
        // Load a couple hundred messages for every channel we're in
        const channels: Record<string, { channel: Discord.TextBasedChannel; last_seen: number; done: boolean }> = {};
        for (const [_, channel] of await this.guild.channels.fetch()) {
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

    //
    // Logging
    //

    critical_error(this: this, error: Error): void;
    critical_error<T>(this: this, arg: T extends Error ? never : T, error?: Error): void;
    critical_error(this: this, arg: any, error?: Error) {
        if (error === undefined) {
            M.error(arg);
        } else {
            M.error(arg, error);
        }
        if (!this.log_channel) {
            return;
        }
        let message = `🛑 Critical error: ${to_string(arg)}` + this.mom_ping;
        if (error !== undefined) {
            message += ` ${error}`;
        }
        send_long_message_markdown_aware(this.log_channel, message)
            .catch(() => M.error)
            .finally(() => {
                assert(!(error && arg instanceof Error)); // should be prevented statically
                if (error !== undefined) {
                    Sentry.captureException(error, { data: to_string(arg) });
                } else if (arg instanceof Error) {
                    Sentry.captureException(arg);
                } else {
                    Sentry.captureMessage(to_string(arg));
                }
            });
    }

    warn(arg: any) {
        M.error(arg);
        if (!this.log_channel) {
            return;
        }
        send_long_message_markdown_aware(this.log_channel, `⚠️ Ignorable error: ${to_string(arg)}`)
            .catch(M.error)
            .finally(() => {
                if (arg instanceof Error) {
                    Sentry.captureException(arg);
                } else {
                    Sentry.captureMessage(to_string(arg));
                }
            });
    }

    info(message: string) {
        M.info(message);
        if (!this.log_channel) {
            return;
        }
        send_long_message_markdown_aware(this.log_channel, `ℹ️ Info: ${message}`)
            .catch(M.error)
            .finally(() => {
                Sentry.captureMessage(message);
            });
    }

    alert(message: string) {
        M.info(message);
        if (!this.log_channel) {
            return;
        }
        send_long_message_markdown_aware(this.log_channel, `🚨 Alert: ${message}` + this.mom_ping)
            .catch(M.error)
            .finally(() => {
                Sentry.captureMessage(message);
            });
    }

    //
    // Common discord utilities
    //

    llog(channel: LoggableChannel, message: Discord.MessageCreateOptions) {
        this.log_limiter.log(channel, message);
    }

    // utility: returns the channel for regular channels or the thread / forum post parent
    top_level_channel(channel: Discord.TextBasedChannel) {
        if (channel instanceof Discord.ThreadChannel && channel.parentId != null) {
            return channel.parentId;
        } else {
            return channel.id;
        }
    }

    /**
     * Search for a specific channel by name if the provided name is not found then instead search by id.
     */
    async get_channel(name: string, id: string, guild_to_check: Discord.Guild = this.guild) {
        if (process.env.NODE_ENV === "development") {
            const channel_by_name = guild_to_check.channels.cache.find(channel => channel.name === name);
            if (channel_by_name) {
                return channel_by_name;
            }
        }

        const channel_by_id = guild_to_check.channels.cache.get(id);
        if (channel_by_id) {
            return channel_by_id as Discord.GuildChannel;
        }

        return null;
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

    async check_permissions(
        options: Discord.GuildMember | Discord.User | Discord.UserResolvable | Discord.FetchMemberOptions,
        permissions: Discord.PermissionResolvable,
    ) {
        const member = await this.try_fetch_guild_member(options);
        return !!member?.permissions.has(permissions);
    }

    async is_established_member(
        options: Discord.GuildMember | Discord.User | Discord.UserResolvable | Discord.FetchMemberOptions,
    ) {
        const member = await this.try_fetch_guild_member(options);
        if (!member || (member.joinedAt && member.joinedAt.getDate() + 28 * DAY <= Date.now())) {
            return false;
        }
        return (
            member.premiumSince != null ||
            member.permissions.has(Discord.PermissionFlagsBits.MuteMembers) ||
            member.permissions.has(Discord.PermissionFlagsBits.ModerateMembers)
        );
    }

    async is_public_channel(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        return (
            !(channel instanceof Discord.ForumChannel) &&
            !channel.isDMBased() &&
            !(channel.isThread() && channel.type == Discord.ChannelType.PrivateThread) &&
            channel.permissionsFor(this.guild.roles.everyone).has("ViewChannel")
        );
    }

    async try_fetch_guild_member(
        options: Discord.GuildMember | Discord.User | Discord.UserResolvable | Discord.FetchMemberOptions,
    ): Promise<Discord.GuildMember | null> {
        if (options instanceof Discord.GuildMember) {
            if (options.guild.id == this.guild.id) {
                return options;
            } else {
                return await this.try_fetch_guild_member(options.id);
            }
        } else {
            try {
                return await this.guild.members.fetch(options);
            } catch (e) {
                // unknown member/user
                if (e instanceof Discord.DiscordAPIError && (e.code === 10007 || e.code == 10013)) {
                    return null;
                } else {
                    throw e;
                }
            }
        }
    }

    async get_display_name(thing: Discord.Message | Discord.User): Promise<string> {
        if (thing instanceof Discord.User) {
            const user = thing;
            try {
                return (await this.guild.members.fetch(user.id)).displayName;
            } catch {
                // user could potentially not be in the server
                return user.displayName;
            }
        } else if (thing instanceof Discord.Message) {
            const message = thing;
            if (message.member == null) {
                return this.get_display_name(message.author);
            } else {
                return message.member.displayName;
            }
        } else {
            assert(false);
        }
    }

    //
    // Basic interaction and command stuff
    //

    get_command(command: string) {
        return this.command_handler.get_command(command);
    }

    get_all_commands() {
        return this.command_handler.get_all_commands();
    }

    register_non_command_bot_reply(trigger: Discord.Message, message: Discord.Message) {
        this.command_handler.register_non_command_bot_reply(trigger, message);
    }

    increment_message_counters(message: Discord.Message) {
        try {
            if (message.guildId == this.guild.id) {
                if (!message.author.bot) {
                    this.message_counter.labels({ type: "normal" }).inc();
                } else {
                    this.message_counter.labels({ type: "bot" }).inc();
                }
                if (message.author.id == this.user.id) {
                    this.message_counter.labels({ type: "wheatley" }).inc();
                }
            }
        } catch (e) {
            this.critical_error(e);
        }
    }

    async on_message(message: Discord.Message) {
        this.increment_message_counters(message);
    }

    async migrate_db(database: WheatleyDatabase) {
        const collection_info = await database.list_collections();
        if (!collection_info.has("component_state") && collection_info.has("wheatley")) {
            const component_state = database.get_collection("component_state");
            const bot_singleton = await database.get_collection("wheatley").findOne({ id: "main" });
            if (bot_singleton) {
                M.log("migrating database...");
                await component_state.insertOne({
                    id: "moderation",
                    case_number: bot_singleton.moderation_case_number - 1,
                    modmail_id: bot_singleton.modmail_id_counter - 1,
                    watch_number: bot_singleton.watch_number - 1,
                });
                await component_state.insertOne({
                    id: "server_suggestions",
                    last_scanned_timestamp: bot_singleton.server_suggestions.last_scanned_timestamp,
                });
                await component_state.insertOne({
                    id: "the_button",
                    button_presses: bot_singleton.the_button.button_presses,
                    last_reset: bot_singleton.the_button.last_reset,
                    longest_time_without_reset: bot_singleton.the_button.longest_time_without_reset,
                });
                await component_state.insertOne({
                    id: "starboard",
                    delete_emojis: bot_singleton.starboard.delete_emojis,
                    ignored_emojis: bot_singleton.starboard.ignored_emojis,
                    negative_emojis: bot_singleton.starboard.negative_emojis,
                    repost_emojis: bot_singleton.starboard.repost_emojis,
                });
            }
        }
    }
}
