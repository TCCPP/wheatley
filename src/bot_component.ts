import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { critical_error } from "./utils";

import { Wheatley } from "./wheatley";

export class BotComponent {
    constructor(protected readonly wheatley: Wheatley) {
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
        wheatley.client.on("ready", wrap(this.on_ready));
        wheatley.client.on("messageCreate", wrap(this.on_message_create));
        wheatley.client.on("messageDelete", wrap(this.on_message_delete));
        wheatley.client.on("messageUpdate", wrap(this.on_message_update));
        wheatley.client.on("guildMemberAdd", wrap(this.on_guild_member_add));
        wheatley.client.on("guildMemberUpdate", wrap(this.on_guild_member_update));
        wheatley.client.on("reactionAdd", wrap(this.on_reaction_add));
        wheatley.client.on("reactionRemove", wrap(this.on_reaction_remove));
        wheatley.client.on("threadCreate", wrap(this.on_thread_create));
    }
    /* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */
    async on_ready() {}
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
