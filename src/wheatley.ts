import { strict as assert } from "assert";
import * as Sentry from "@sentry/node";

import * as Discord from "discord.js";
import * as mongo from "mongodb";
import PromClient from "prom-client";

import { colors, MINUTE } from "./common.js";
import { unwrap } from "./utils/misc.js";
import { to_string, is_string } from "./utils/strings.js";
import { globIterateSync } from "glob";
import { PathScurry } from "path-scurry";
import { M } from "./utils/debugging-and-logging.js";
import { BotComponent } from "./bot-component.js";

import { CommandAbstractionReplyOptions } from "./command-abstractions/text-based-command.js";

import { WheatleyDatabase } from "./infra/database-interface.js";
import { MemberTracker } from "./infra/member-tracker.js";
import { forge_snowflake, send_long_message } from "./utils/discord.js";
import { TypedEventEmitter } from "./utils/event-emitter.js";
import { setup_metrics_server } from "./infra/prometheus.js";
import { moderation_entry } from "./components/moderation/schemata.js";
import { LoggableChannel, LogLimiter } from "./infra/log-limiter.js";
import { CommandHandler } from "./command-handler.js";
import { CommandSetBuilder } from "./command-abstractions/command-set-builder.js";

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

const channels = {
    // staff
    staff_flag_log: "1026972603019169842",
    staff_experimental_log: "1207899185790197760",
    staff_action_log: "845290775692443699",
    public_action_log: "1341611685223596103",
    staff_clock_log: "1220882759862452284",
    welcome: "778017793567490078",
    staff_member_log: "875681819662622730",
    staff_message_log: "467729928956411914",
    staff_only: "342153262260289537",
    mods: "847993258600038460",
    voice_hotline: "1379456835634987098",
    // meta
    rules: "659868782877212723",
    announcements: "331881381477089282",
    server_suggestions: "802541516655951892",
    skill_role_suggestions: "1211089633547526204",
    skill_roles_meta: "1182536717056618557",
    news: "1269506410530738267",
    old_resources: "1124619767542718524",
    resources: "1361574878561570926",
    partners: "904790565000986745",
    the_button: "1069678919667687455",
    articles: "1130174377539940475",
    // language channels
    cpp_help: "1013107104678162544",
    c_help: "1013104018739974194",
    cpp_help_text: "331718580070645760",
    c_help_text: "331718539738087426",
    c_cpp_discussion: "851121440425639956",
    general_discussion: "855220264149057556",
    code_review: "1078717238678409369",
    showcase: "1014328785685979136",
    tooling: "331913460080181258",
    algorithms_and_compsci: "857668280012242944",
    // off-topic
    starboard: "800509841424252968",
    memes: "526518219549442071",
    food: "1288515484513468436",
    serious_off_topic: "921113903574958080",
    room_of_requirement: "1082800064113672192",
    boosters_only: "792183875241639977",
    // other
    bot_spam: "506274405500977153",
    introductions: "933113495304679494",
    cursed_code: "855220292736516128",
    suggestion_dashboard: "908928083879415839",
    suggestion_action_log: "909309608512880681",
    today_i_learned: "873682069325217802",
    goals2024: "1189255286364569640",
    goals2025: "1323734788707848253",
    days_since_last_incident: "1195920462958575676",
    literally_1984: "1097993854214488154",
    lore: "890067781628866620",
    bot_dev_internal: "1166517065763536977",
    pin_archive: "1284234644396572714",
    skill_role_log: "1315023714206617610",
    polls: "1319336135213846568",
    wiki_dev: "1350899338229846127",
    // voice
    chill: "1358502332941467879",
    work_3: "1358502770575147230",
    work_4: "1367735453112864838",
    afk: "331732845523369985",
    deans_office: "1379612678649155755",
    // red telephone
    red_telephone_alerts: "1140096352278290512",
    // error log
    log: "1260777903700971581",
};

const roles_map = {
    muted: "815987333094178825",
    monke: "1139378060450332752",
    no_off_topic: "879419994004422666",
    no_suggestions: "831567015457980447",
    no_suggestions_at_all: "895011256023535657",
    no_reactions: "880152014036819968",
    no_images: "1181029004866760854",
    no_threads: "870181444742447135",
    no_serious_off_topic: "921116034948272260",
    no_til: "883474632370454588",
    no_memes: "982307359370141756",
    no_voice: "1371771250363465892",
    voice_deputy: "1371706420730531870",
    moderators: "847915341954154536",
    root: "331719468440879105",
    pink: "888158339878490132",
    server_booster: "643013330616844333",
    historian: "890067617069551646",
    official_bot: "331886851784704001",
    featured_bot: "995847409374605392",
    jedi_council: "1138950835208990750",
    herald: "1095555811536797787",
    linked_github: "1080596526478397471",
    wiki_core: "1354998426370314411",
    voice: "1368073548983308328",
};

const skill_roles_map = {
    beginner: "784733371275673600",
    intermediate: "331876085820030978",
    proficient: "849399021838925834",
    advanced: "331719590990184450",
    expert: "331719591405551616",
};

export const skill_roles_order = ["beginner", "intermediate", "proficient", "advanced", "expert"];

export const skill_roles_order_id = [
    "784733371275673600",
    "331876085820030978",
    "849399021838925834",
    "331719590990184450",
    "331719591405551616",
];

type EventMap = {
    wheatley_ready: () => void;
    issue_moderation: (moderation: moderation_entry) => void;
    update_moderation: (moderation: mongo.WithId<moderation_entry>) => void;
};

export class Wheatley {
    private discord_user!: Discord.User | null;
    private discord_guild!: Discord.Guild | null;
    get user() {
        return unwrap(this.discord_user);
    }
    get guild() {
        return unwrap(this.discord_guild);
    }

    readonly event_hub = new TypedEventEmitter<EventMap>();
    readonly components = new Map<string, BotComponent>();
    readonly tracker: MemberTracker; // TODO: Rename
    readonly log_limiter: LogLimiter;

    private command_handler!: CommandHandler;

    private db!: WheatleyDatabase | null;
    get database() {
        return unwrap(this.db);
    }

    // True if freestanding mode is enabled. Defaults to false.
    readonly freestanding: boolean;

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

    readonly roles: {
        [k in keyof typeof roles_map]: Discord.Role;
    } = {} as any;
    readonly skill_roles: {
        [k in keyof typeof skill_roles_map]: Discord.Role;
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

        this.tracker = new MemberTracker();
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
            (async () => {
                // Fetch the log channel immediately
                if (!config.freestanding) {
                    const channel = await this.client.channels.fetch(channels.log);
                    this.log_channel = channel && channel.isTextBased() ? channel : null;
                }

                this.info("Bot started");

                this.discord_user = await this.client.users.fetch(config.id);
                this.discord_guild = await this.client.guilds.fetch(config.guild);
                await this.fetch_emoji();
                await this.fetch_guild_info();

                const command_set_builder = new CommandSetBuilder(this);
                for (const component of this.components.values()) {
                    try {
                        await component.setup(command_set_builder);
                    } catch (e) {
                        this.critical_error(e);
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
                this.tracker.connect(this);
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
        // Roles
        await Promise.all(
            Object.entries(roles_map).map(async ([k, id]) => {
                const role = await wrap(() => this.guild.roles.fetch(id));
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
                const role = await wrap(() => this.guild.roles.fetch(id));
                if (this.freestanding && role === null) {
                    return;
                }
                assert(role !== null, `Role ${k} ${id} not found`);
                this.skill_roles[k as keyof typeof skill_roles_map] = role;
                M.log(`Fetched role ${k}`);
            }),
        );
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

    critical_error(arg: any) {
        M.error(arg);
        if (!this.log_channel) {
            return;
        }
        send_long_message(this.log_channel, `🛑 Critical error: ${to_string(arg)}` + this.mom_ping)
            .catch(() => M.error)
            .finally(() => {
                if (arg instanceof Error) {
                    Sentry.captureException(arg);
                } else {
                    Sentry.captureMessage(to_string(arg));
                }
            });
    }

    ignorable_error(arg: any) {
        M.error(arg);
        if (!this.log_channel) {
            return;
        }
        send_long_message(this.log_channel, `⚠️ Ignorable error: ${to_string(arg)}`)
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
        send_long_message(this.log_channel, `ℹ️ Info: ${message}`)
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
        send_long_message(this.log_channel, `🚨 Alert: ${message}` + this.mom_ping)
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

    is_forum_help_channel(id: string) {
        return [this.channels.cpp_help, this.channels.c_help].includes(id);
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

    has_skill_roles_other_than_beginner(member: Discord.GuildMember) {
        const non_beginner_skill_role_ids = Object.entries(this.skill_roles)
            .filter(([name, _]) => name !== "beginner")
            .map(([_, role]) => role.id);
        return member.roles.cache.some(role => non_beginner_skill_role_ids.includes(role.id));
    }

    // higher is better
    get_skill_role_index(role: Discord.Role | string) {
        return skill_roles_order_id.indexOf(role instanceof Discord.Role ? role.id : role);
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
