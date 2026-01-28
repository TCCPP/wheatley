import { strict as assert } from "assert";
import * as Sentry from "@sentry/node";

import * as Discord from "discord.js";
import * as mongo from "mongodb";
import PromClient from "prom-client";

import { colors, MINUTE, DAY } from "./common.js";
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

type named_id = {
    // channel id used in production
    id: Discord.Snowflake;

    // fallback channel name (for development only)
    name?: string;
};

const channels: { [key: string]: named_id } = {
    // staff
    staff_flag_log: { id: "1026972603019169842", name: "🚩-flag-log" },
    staff_delet_log: { id: "1462879414864838869", name: "🗑️-delet-log" },
    staff_experimental_log: { id: "1207899185790197760", name: "😱-experimental-log" },
    staff_action_log: { id: "845290775692443699", name: "🔨-action-log" },
    public_action_log: { id: "1341611685223596103", name: "moderation-log" },
    staff_clock_log: { id: "1220882759862452284", name: "👀-clock-log" },
    welcome: { id: "778017793567490078", name: "📈-join-boost-log" },
    staff_member_log: { id: "875681819662622730", name: "👥-member-log" },
    staff_message_log: { id: "467729928956411914", name: "💬-message-log" },
    staff_only: { id: "342153262260289537", name: "staff-only" },
    mods: { id: "847993258600038460", name: "mods-🚲" },
    voice_hotline: { id: "1379456835634987098", name: "voice-hotline" },

    // meta
    rules: { id: "659868782877212723", name: "rules" },
    announcements: { id: "331881381477089282", name: "announcements" },
    server_suggestions: { id: "802541516655951892", name: "server-suggestions" },
    skill_role_suggestions: { id: "1211089633547526204", name: "skill-role-suggestions" },
    skill_roles_meta: { id: "1182536717056618557", name: "skill-roles-meta" },
    news: { id: "1269506410530738267", name: "news" },
    old_resources: { id: "1124619767542718524", name: "old-resources" },
    resources: { id: "1361574878561570926", name: "resources" },
    partners: { id: "904790565000986745", name: "partners" },
    the_button: { id: "1069678919667687455", name: "the-button" },
    articles: { id: "1130174377539940475", name: "archived-articles" },

    // language channels
    cpp_help: { id: "1013107104678162544", name: "cpp-help" },
    c_help: { id: "1013104018739974194", name: "c-help" },
    cpp_help_text: { id: "331718580070645760", name: "cpp-help-text" },
    c_help_text: { id: "331718539738087426", name: "c-help-text" },
    c_cpp_discussion: { id: "851121440425639956", name: "c-cpp-discussion" },
    general_discussion: { id: "855220264149057556", name: "general-technical" },
    code_review: { id: "1078717238678409369", name: "code-review" },
    showcase: { id: "1014328785685979136", name: "showcase" },
    tooling: { id: "331913460080181258", name: "tooling" },
    algorithms_and_compsci: { id: "857668280012242944", name: "algorithms-and-compsci" },

    // off-topic
    starboard: { id: "800509841424252968", name: "starboard" },
    memes: { id: "526518219549442071", name: "memes" },
    food: { id: "1288515484513468436", name: "food" },
    serious_off_topic: { id: "921113903574958080", name: "serious-off-topic" },
    room_of_requirement: { id: "1082800064113672192", name: "pets" },
    boosters_only: { id: "792183875241639977", name: "🩷pink🩷" },

    // other
    bot_spam: { id: "506274405500977153", name: "bot-spam" },
    introductions: { id: "933113495304679494", name: "introductions" },
    cursed_code: { id: "855220292736516128", name: "cursed-code" },
    suggestion_dashboard: { id: "908928083879415839", name: "Suggestions Dashboard" },
    suggestion_action_log: { id: "909309608512880681", name: "Suggestion Action Log" },
    today_i_learned: { id: "873682069325217802", name: "did-you-know" },
    goals2024: { id: "1189255286364569640", name: "2024-goals" },
    goals2025: { id: "1323734788707848253", name: "2025-goals" },
    goals2026: { id: "1454237273712492615", name: "archived-2026-goals" },
    days_since_last_incident: { id: "1195920462958575676", name: "days-since-last-incident" },
    literally_1984: { id: "1097993854214488154", name: "literally-1984" },
    lore: { id: "890067781628866620", name: "lore" },
    bot_dev_internal: { id: "1166517065763536977", name: "wheatley-dev-internal" },
    pin_archive: { id: "1284234644396572714", name: "pin-archive" },
    skill_role_log: { id: "1315023714206617610", name: "skill-role-log" },
    polls: { id: "1319336135213846568", name: "polls" },
    wiki_dev: { id: "1350899338229846127", name: "wiki-dev" },

    // voice
    chill: { id: "1358502332941467879", name: "Chill" },
    work_3: { id: "1358502770575147230", name: "Work 3" },
    work_4: { id: "1367735453112864838", name: "Work 4" },
    afk: { id: "331732845523369985", name: "AFK" },
    deans_office: { id: "1379612678649155755", name: "Dean's Office" },

    // red telephone
    red_telephone_alerts: { id: "1140096352278290512", name: "red-telephone-alerts" },

    // error log
    log: { id: "1260777903700971581", name: "🤖-wheatley-log" },
};

const roles_map: { [key: string]: named_id } = {
    muted: { id: "815987333094178825", name: "Muted" },
    monke: { id: "1139378060450332752", name: "Neuron Activation" },
    no_off_topic: { id: "879419994004422666", name: "No Off Topic" },
    no_suggestions: { id: "831567015457980447", name: "No Suggestions" },
    no_suggestions_at_all: { id: "895011256023535657", name: "No Suggestions At All" },
    no_reactions: { id: "880152014036819968", name: "No Reactions" },
    no_images: { id: "1181029004866760854", name: "No Images" },
    no_threads: { id: "870181444742447135", name: "No Threads" },
    no_serious_off_topic: { id: "921116034948272260", name: "No Serious Off Topic" },
    no_til: { id: "883474632370454588", name: "No TIL" },
    no_memes: { id: "982307359370141756", name: "No Memes" },
    no_voice: { id: "1371771250363465892", name: "No Voice" },
    voice_moderator: { id: "1371706420730531870", name: "Voice Moderator" },
    moderators: { id: "847915341954154536", name: "Moderator" },
    root: { id: "331719468440879105", name: "root" },
    pink: { id: "888158339878490132", name: "Pink" },
    server_booster: { id: "643013330616844333", name: "Server Booster" },
    historian: { id: "890067617069551646", name: "Historian" },
    official_bot: { id: "331886851784704001", name: "Official Bot" },
    featured_bot: { id: "995847409374605392", name: "Featured Bot" },
    jedi_council: { id: "1138950835208990750", name: "Jedi Council" },
    herald: { id: "1095555811536797787", name: "Herald" },
    linked_github: { id: "1080596526478397471", name: "Linked GitHub" },
    wiki_core: { id: "1354998426370314411", name: "core-wiki" },
    voice: { id: "1368073548983308328", name: "voice" },
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

    readonly channels = channels;
    readonly roles_map = roles_map;

    readonly roles: {
        [k in keyof typeof roles_map]: Discord.Role;
    } = {} as any;

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

                if (!this.validateChannelsAndRoles()) {
                    throw new Error("One or more channels/roles could not be found");
                }

                // Fetch the log channel immediately
                if (!config.freestanding) {
                    const channel = await this.client.channels.fetch(channels.log.id);
                    this.log_channel = channel && channel.isTextBased() ? channel : null;
                }

                this.info("Bot started");

                await this.fetch_emoji();
                await this.fetch_guild_info();

                const command_set_builder = new CommandSetBuilder(this);
                for (const component of this.components.values()) {
                    try {
                        await component.setup(command_set_builder);
                    } catch (e) {
                        this.critical_error(`Error setting up component ${component.constructor.name}:\n`, e as Error);
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

    async fetch_guild_info() {
        const wrap = async <T>(fn: () => Promise<T>): Promise<T | null> => {
            try {
                return await fn();
            } catch (e) {
                if (!this.freestanding) {
                    this.critical_error(e);
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

    validateChannelsAndRoles() {
        let success = true;

        for (const [key, info] of Object.entries(this.channels)) {
            let channel: any = this.client.channels.cache.get(info.id);

            if (!channel && this.devmode_enabled && info.name) {
                const matches = this.client.channels.cache.filter(ch => (ch as any).name === info.name);

                if (matches.size === 1) {
                    channel = matches.first()!;
                    M.debug(`Resolved channel ${key} by name "${info.name}" (${channel.id})`);
                    info.id = channel.id;
                } else if (matches.size > 1) {
                    M.warn(`Multiple channels named "${info.name}" — cannot resolve ${key}`);
                    success = false;
                }
            }

            if (!channel) {
                M.warn(`Could not resolve channel ${key} (id: ${info.id}, name: ${info.name ?? "-"})`);
                success = false;
            }
        }

        for (const [key, info] of Object.entries(this.roles_map)) {
            let role = this.guild.roles.cache.get(info.id);

            if (!role && this.devmode_enabled && info.name) {
                const matches = this.guild.roles.cache.filter(r => r.name === info.name);

                if (matches.size === 1) {
                    role = matches.first()!;
                    M.debug(`Resolved role ${key} by name "${info.name}" (${role.id})`);
                    info.id = role.id;
                } else if (matches.size > 1) {
                    M.warn(`Multiple roles named "${info.name}" — cannot resolve ${key}`);
                    success = false;
                }
            }

            if (role) {
                this.roles[key as keyof typeof this.roles_map] = role;
            } else {
                M.warn(`Could not resolve role ${key} (id: ${info.id}, name: ${info.name ?? "n/a"})`);
                success = false;
            }
        }

        return success;
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

    is_forum_help_channel(id: Discord.Snowflake) {
        return [this.channels.cpp_help, this.channels.c_help].some(ch => ch.id === id);
    }

    is_forum_help_thread(thread: Discord.ThreadChannel) {
        return thread.parentId != null && this.is_forum_help_channel(thread.parentId);
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

    staff_contacts() {
        const roots = this.roles.root.members.map(member => `<@${member.id}>`);
        return roots.length > 1 ? roots.slice(0, -1).join(", ") + `, or ${roots[roots.length - 1]}` : roots[0];
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

    // case-insensitive
    get_role_by_name(name: string) {
        return unwrap(this.guild.roles.cache.find(role => role.name.toLowerCase() === name.toLowerCase()));
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
