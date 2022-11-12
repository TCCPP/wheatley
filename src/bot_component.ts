import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { CommandBuilder } from "./command";
import { critical_error } from "./utils";

import { Wheatley } from "./wheatley";

type Arr = readonly unknown[];
const wrap = <T extends Arr>(f: ((...args: [...T]) => void)) => {
    return async (...args: [...T]) => {
        try {
            await f(...args);
        } catch(e) {
            critical_error(e);
        }
    };
};

export class BotComponent {
    constructor(protected readonly wheatley: Wheatley) {
        wheatley.on("wheatley_ready", wrap(this.on_wheatley_ready.bind(this)));
    }
    private on_wheatley_ready() {
        this.wheatley.client.on("messageCreate", wrap(this.on_message_create.bind(this)));
        this.wheatley.client.on("messageDelete", wrap(this.on_message_delete.bind(this)));
        this.wheatley.client.on("messageUpdate", wrap(this.on_message_update.bind(this)));
        this.wheatley.client.on("messageReactionAdd", wrap(this.on_reaction_add.bind(this)));
        this.wheatley.client.on("messageReactionRemove", wrap(this.on_reaction_remove.bind(this)));
        this.wheatley.client.on("interactionCreate", wrap(this.on_interaction_create.bind(this)));
        this.wheatley.client.on("guildMemberAdd", wrap(this.on_guild_member_add.bind(this)));
        this.wheatley.client.on("guildMemberUpdate", wrap(this.on_guild_member_update.bind(this)));
        this.wheatley.client.on("threadCreate", wrap(this.on_thread_create.bind(this)));
        this.on_ready();
    }
    /* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    async setup() {}
    add_command<T extends unknown[]>(command: CommandBuilder<T, true, true>) {
        this.wheatley.add_command(command);
    }
    // events
    // TODO: Make stuff optional
    async on_ready() {} // actually on wheatley ready
    async on_message_create(message: Discord.Message) {}
    async on_message_delete(message: Discord.Message | Discord.PartialMessage) {}
    async on_message_update(old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage) {}
    async on_interaction_create(interaction: Discord.Interaction) {}
    async on_guild_member_add(member: Discord.GuildMember) {}
    async on_guild_member_update(old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember) {}
    async on_reaction_add(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser) {}
    async on_reaction_remove(reaction: Discord.MessageReaction | Discord.PartialMessageReaction,
        user: Discord.User                | Discord.PartialUser) {}
    async on_thread_create(thread: Discord.ThreadChannel) {}
    /* eslint-enable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    // TODO: Register slash command...
    // TODO: Try/catch wrappers for everything.......
}
