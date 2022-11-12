import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { denullify, escape_regex, is_string } from "./utils";
import { Wheatley } from "./wheatley";

export type CommandOptionType = "string";

export type CommandOption = {
    title: string;
    description: string;
    required?: boolean;
    autocomplete?: (partial: string, command_name: string) => { name: string, value: string }[];
};

type Append<T extends unknown[], U> = [...T, U];

type ConditionalOptional<C extends true | false, T> = C extends true ? T : T | undefined;

export class CommandBuilder<Args extends unknown[] = [], HasHandler extends boolean = false> {
    descriptions: string[] = [];
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: ConditionalOptional<HasHandler, (x: Command, ...args: Args) => any>;
    readonly names: string[];

    constructor(names: string | string[]) {
        this.names = Array.isArray(names) ? names : [names];
    }

    set_description(descriptions: string | string[]) {
        this.descriptions = Array.isArray(descriptions) ? descriptions : [descriptions];
        if(this.descriptions.length != this.names.length) {
            assert(this.descriptions.length == 1);
            this.descriptions = new Array(this.names.length).fill(this.descriptions[0]);
        }
        return this;
    }

    add_string_option(option: CommandOption): CommandBuilder<Append<Args, string>> {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "string"
        });
        return this as unknown as CommandBuilder<Append<Args, string>>;
    }

    set_handler(handler: (x: Command, ...args: Args) => any): CommandBuilder<Args, true> {
        this.handler = handler;
        return this as unknown as CommandBuilder<Args, true>;
    }
}

export class BotCommand<Args extends unknown[] = []> {
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: (x: Command, ...args: Args) => any;

    constructor(public readonly name: string,
                public readonly description: string,
                builder: CommandBuilder<Args, true>) {
        this.options = builder.options;
        this.handler = builder.handler;
    }
}

export type CommandAbstractionReplyOptions = {
    // default: false
    should_text_reply?: boolean;
    // default: false
    ephemeral_if_possible?: boolean;
    // default: true
    deletable?: boolean;
}

const default_allowed_mentions: Discord.MessageMentionOptions = {
    parse: ["users"]
};

export class Command {
    public readonly guild: Discord.Guild | null;
    public readonly guild_id: string | null;
    public readonly channel: Discord.TextBasedChannel | null;
    public readonly channel_id: string;
    public readonly member: Discord.GuildMember | Discord.APIInteractionGuildMember | null;
    public readonly user: Discord.User;

    constructor(
        public readonly name: string,
        private readonly reply_object: Discord.ChatInputCommandInteraction | Discord.Message,
        private readonly wheatley: Wheatley
    ) {
        if(this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            this.guild = this.reply_object.guild;
            this.guild_id = this.reply_object.guildId;
            this.channel = this.reply_object.channel;
            this.channel_id = this.reply_object.channelId;
            this.member = this.reply_object.member;
            this.user = this.reply_object.user;
        } else {
            this.guild = this.reply_object.guild;
            this.guild_id = this.reply_object.guildId;
            this.channel = this.reply_object.channel;
            this.channel_id = this.reply_object.channelId;
            this.member = this.reply_object.member;
            this.user = this.reply_object.author;
        }
    }

    async get_guild() {
        if(this.guild) {
            return this.guild;
        } else {
            if(this.guild_id) {
                return await this.wheatley.client.guilds.fetch(this.guild_id);
            } else {
                throw Error("No guild");
            }
        }
    }

    async get_channel(): Promise<Discord.TextBasedChannel> {
        if(this.channel) {
            return this.channel;
        } else {
            return <Discord.TextBasedChannel>denullify(await (await this.get_guild()).channels.fetch(this.channel_id));
        }
    }

    async get_member() {
        if(this.member instanceof Discord.GuildMember) {
            return this.member;
        } else {
            return await (await this.get_guild()).members.fetch(this.user.id);
        }
    }

    async reply(raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions)) {
        if(is_string(raw_message_options)) {
            raw_message_options = {
                content: raw_message_options
            };
        }
        const message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions = {
            deletable: true,
            allowedMentions: default_allowed_mentions,
            ...raw_message_options
        };
        if(this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            await this.reply_object.reply({
                ephemeral: !!message_options.ephemeral_if_possible,
                ...message_options
            });
        } else {
            if(message_options.should_text_reply) {
                const message = await this.reply_object.reply(message_options);
                if(message_options.deletable) {
                    this.wheatley.deletable.make_message_deletable(this.reply_object, message);
                }
            } else {
                const message = await this.reply_object.channel.send(message_options);
                if(message_options.deletable) {
                    this.wheatley.deletable.make_message_deletable(this.reply_object, message);
                }
            }
        }
    }

    async react(emoji: string, ephemeral_if_possible = false) {
        if(this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            await this.reply_object.reply({
                content: emoji,
                ephemeral: ephemeral_if_possible,
                allowedMentions: default_allowed_mentions,
            });
        } else {
            await this.reply_object.react(emoji);
        }
    }
}
