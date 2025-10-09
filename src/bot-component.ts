import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { M } from "./utils/debugging-and-logging.js";

import { Wheatley } from "./wheatley.js";
import { CommandSetBuilder } from "./command-abstractions/command-set-builder.js";
import { BotUtilities } from "./bot-utilities.js";

type Arr = readonly unknown[];

export class BotComponent {
    static get is_freestanding() {
        return false;
    }

    protected readonly utilities: BotUtilities;

    constructor(protected readonly wheatley: Wheatley) {
        this.utilities = new BotUtilities(wheatley);
        wheatley.event_hub.on("wheatley_ready", this.wrap(this.on_wheatley_ready.bind(this)));
    }

    private wrap<T extends Arr>(f: (...args: [...T]) => void | Promise<void>) {
        return (...args: [...T]) => {
            (async () => {
                try {
                    await f(...args);
                } catch (e) {
                    this.wheatley.critical_error(e);
                }
            })().catch(this.wheatley.critical_error.bind(this.wheatley));
        };
    }

    // Called after all components are constructed and the bot logs in, commands can be added here
    async setup(commands: CommandSetBuilder) {}

    listeners: [keyof Discord.ClientEvents, (...args: any[]) => any][] = [];

    protected setup_listener<E extends keyof Discord.ClientEvents>(
        event: E,
        f: undefined | ((...args: Discord.ClientEvents[E]) => Promise<void>),
    ) {
        if (f) {
            M.log("Adding listener", event, this.constructor.name);
            const listener = this.wrap(f.bind(this));
            this.wheatley.client.on(event, listener);
            this.listeners.push([event, listener]);
        }
    }

    private on_wheatley_ready() {
        this.on_ready()
            .catch(this.wheatley.critical_error.bind(this.wheatley))
            .finally(() => {
                this.setup_listener("messageCreate", this.on_message_create);
                this.setup_listener("messageDelete", this.on_message_delete);
                this.setup_listener("messageDeleteBulk", this.on_message_delete_bulk);
                this.setup_listener("messageUpdate", this.on_message_update);
                this.setup_listener("messageReactionAdd", this.on_reaction_add);
                this.setup_listener("messageReactionRemove", this.on_reaction_remove);
                this.setup_listener("interactionCreate", this.on_interaction_create);
                this.setup_listener("guildMemberAdd", this.on_guild_member_add);
                this.setup_listener("guildMemberUpdate", this.on_guild_member_update);
                this.setup_listener("guildMemberRemove", this.on_guild_member_remove);
                this.setup_listener("emojiCreate", this.on_emoji_create);
                this.setup_listener("emojiDelete", this.on_emoji_delete);
                this.setup_listener("emojiUpdate", this.on_emoji_update);
                this.setup_listener("threadCreate", this.on_thread_create);
                this.setup_listener("voiceStateUpdate", this.on_voice_state_update);
                this.setup_listener("guildAuditLogEntryCreate", this.on_audit_log_entry_create);
            });
    }

    // events
    async on_ready() {} // actually on wheatley ready
    async on_message_create?(message: Discord.Message): Promise<void>;
    async on_message_delete?(message: Discord.Message | Discord.PartialMessage): Promise<void>;
    async on_message_delete_bulk?(
        messages: Discord.ReadonlyCollection<string, Discord.Message | Discord.PartialMessage>,
        channel: Discord.GuildTextBasedChannel,
    ): Promise<void>;
    async on_message_update?(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ): Promise<void>;
    async on_interaction_create?(interaction: Discord.Interaction): Promise<void>;
    async on_guild_member_add?(member: Discord.GuildMember): Promise<void>;
    async on_guild_member_update?(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ): Promise<void>;
    async on_guild_member_remove?(member: Discord.GuildMember | Discord.PartialGuildMember): Promise<void>;
    async on_emoji_create?(emoji: Discord.GuildEmoji): Promise<void>;
    async on_emoji_delete?(emoji: Discord.GuildEmoji): Promise<void>;
    async on_emoji_update?(old_emoji: Discord.GuildEmoji, new_emoji: Discord.GuildEmoji): Promise<void>;
    async on_reaction_add?(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ): Promise<void>;
    async on_reaction_remove?(
        reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User | Discord.PartialUser,
    ): Promise<void>;
    async on_thread_create?(thread: Discord.ThreadChannel): Promise<void>;
    async on_voice_state_update?(old_state: Discord.VoiceState, new_state: Discord.VoiceState): Promise<void>;
    async on_audit_log_entry_create?(entry: Discord.GuildAuditLogsEntry): Promise<void>;
}
