import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { EventEmitter } from "events";
import * as fs from "fs";

import { DatabaseInterface } from "./infra/database_interface";
import { GuildCommandManager } from "./infra/guild_command_manager";
import { MemberTracker } from "./infra/member_tracker";

import { BotComponent } from "./bot_component";

import { action_log_channel_id, bot_spam_id, cpp_help_id, c_help_id, member_log_channel_id, message_log_channel_id,
         mods_channel_id, rules_channel_id, server_suggestions_channel_id, suggestion_action_log_thread_id,
         suggestion_dashboard_thread_id, TCCPP_ID, welcome_channel_id, zelis_id } from "./common";
import { critical_error, fetch_forum_channel, fetch_text_channel, fetch_thread_channel, M } from "./utils";

import { AntiAutoreact } from "./components/anti_autoreact";
import { AntiRaid } from "./components/anti_raid";
import { AntiScambot } from "./components/anti_scambot";
import { AntiScreenshot } from "./components/anti_screenshot";
import { Autoreact } from "./components/autoreact";
import { Cppref } from "./components/cppref";
import { Deletable } from "./components/deletable";
import { Format } from "./components/format";
import { ForumChannels } from "./components/forum_channels";
import { Inspect } from "./components/inspect";
import { LinkBlacklist } from "./components/link_blacklist";
import { Man7 } from "./components/man7";
import { Massban } from "./components/massban";
import { Modmail } from "./components/modmail";
import { Nodistractions } from "./components/nodistractions";
import { NotifyAboutBrandNewUsers } from "./components/notify_about_brand_new_users";
import { Ping } from "./components/ping";
import { Quote } from "./components/quote";
import { RaidPurge } from "./components/raidpurge";
import { ReadTutoring } from "./components/read_tutoring";
import { RoleManager } from "./components/role_manager";
import { Roulette } from "./components/roulette";
import { ServerSuggestionReactions } from "./components/server_suggestion_reactions";
import { ServerSuggestionTracker } from "./components/server_suggestion_tracker";
import { Snowflake } from "./components/snowflake";
import { Speedrun } from "./components/speedrun";
import { Status } from "./components/status";
import { ThreadBasedChannels } from "./components/thread_based_channels";
import { ThreadControl } from "./components/thread_control";
import { TrackedMentions } from "./components/tracked_mentions";
import { UsernameManager } from "./components/username_manager";
import { UtilityTools } from "./components/utility_tools";
import { Wiki } from "./components/wiki";

export class Wheatley extends EventEmitter {
    private components: BotComponent[] = [];
    readonly guild_command_manager = new GuildCommandManager();
    readonly tracker: MemberTracker; // TODO: Rename
    action_log_channel: Discord.TextChannel;
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

    deletable: Deletable;
    link_blacklist: LinkBlacklist;

    // whether wheatley is ready (client is ready + wheatley has set up)
    ready = false;

    constructor(readonly client: Discord.Client, readonly database: DatabaseInterface) {
        super();

        this.tracker = new MemberTracker(this);
        this.setup();

        this.client.on("error", error => {
            M.error(error);
        });

        // Every module sets a lot of listeners. This is not a leak.
        this.client.setMaxListeners(35);
        this.setMaxListeners(35);
    }

    async setup() {
        this.client.on("ready", async () => {
            // TODO: Log everything?
            const promises = [
                (async () => {
                    this.action_log_channel = await fetch_text_channel(action_log_channel_id);
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
                })()
            ];
            await Promise.all(promises);
            this.emit("wheatley_ready");
            this.ready = true;
        });

        await this.add_component(AntiAutoreact);
        await this.add_component(AntiRaid);
        await this.add_component(AntiScambot);
        await this.add_component(AntiScreenshot);
        await this.add_component(Autoreact);
        await this.add_component(Cppref);
        this.deletable = await this.add_component(Deletable);
        await this.add_component(Format);
        await this.add_component(ForumChannels);
        await this.add_component(Inspect);
        this.link_blacklist = await this.add_component(LinkBlacklist);
        await this.add_component(Man7);
        await this.add_component(Massban);
        await this.add_component(Modmail);
        await this.add_component(Nodistractions);
        await this.add_component(NotifyAboutBrandNewUsers);
        await this.add_component(Ping);
        await this.add_component(Quote);
        await this.add_component(RaidPurge);
        await this.add_component(ReadTutoring);
        await this.add_component(RoleManager);
        await this.add_component(Roulette);
        await this.add_component(ServerSuggestionReactions);
        await this.add_component(ServerSuggestionTracker);
        await this.add_component(Snowflake);
        await this.add_component(Speedrun);
        await this.add_component(Status);
        await this.add_component(ThreadBasedChannels);
        await this.add_component(ThreadControl);
        await this.add_component(TrackedMentions);
        await this.add_component(UsernameManager);
        await this.add_component(UtilityTools);
        await this.add_component(Wiki);

        const token = await fs.promises.readFile("auth.key", { encoding: "utf-8" });

        await this.guild_command_manager.finalize(token);

        M.debug("Logging in");

        this.client.login(token);
    }

    async add_component<T extends BotComponent>(component: { new(w: Wheatley): T }) {
        M.log(`Initializing ${component.name}`);
        const instance = new component(this);
        try {
            await instance.setup();
        } catch(e) {
            critical_error(e);
        }
        this.components.push(instance);
        return instance;
    }
}
