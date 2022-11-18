import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { forge_snowflake } from "./components/snowflake";

import { denullify, is_string } from "./utils";
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

type MoreThanOne<T> = [T, T, ...T[]];

export class CommandBuilder<
    Args extends unknown[] = [],
    HasDescriptions extends boolean = false,
    HasHandler extends boolean = false>
{
    readonly names: string[];
    descriptions: ConditionalOptional<HasDescriptions, string[]>;
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: ConditionalOptional<HasHandler, (x: Command, ...args: Args) => any>;
    slash_config: boolean[];

    constructor(names: string | MoreThanOne<string>) {
        this.names = Array.isArray(names) ? names : [names];
        this.slash_config = new Array(this.names.length).fill(true);
    }

    set_description(raw_descriptions: string | MoreThanOne<string>): CommandBuilder<Args, true, HasHandler> {
        const descriptions = Array.isArray(raw_descriptions) ? raw_descriptions : [raw_descriptions];
        if(descriptions.length == this.names.length) {
            this.descriptions = descriptions;
        } else {
            assert(descriptions.length == 1);
            this.descriptions = new Array(this.names.length).fill(descriptions[0]);
        }
        return this as unknown as CommandBuilder<Args, true, HasHandler>;
    }

    add_string_option(option: CommandOption): CommandBuilder<Append<Args, string>, HasDescriptions, HasHandler> {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "string"
        });
        return this as unknown as CommandBuilder<Append<Args, string>, HasDescriptions, HasHandler>;
    }

    set_handler(handler: (x: Command, ...args: Args) => any): CommandBuilder<Args, HasDescriptions, true> {
        this.handler = handler;
        return this as unknown as CommandBuilder<Args, HasDescriptions, true>;
    }

    set_slash(...config: boolean[]) {
        if(config.length == this.names.length) {
            this.slash_config = config;
        } else {
            assert(config.length == 1);
            this.slash_config = new Array(this.names.length).fill(config[0]);
        }
        return this;
    }
}

export class BotCommand<Args extends unknown[] = []> {
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: (x: Command, ...args: Args) => any;

    constructor(public readonly name: string,
                public readonly description: string | undefined,
                public readonly slash: boolean,
                builder: CommandBuilder<Args, true, true>) {
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
    public readonly name: string;
    private readonly wheatley: Wheatley;
    private readonly reply_object: Discord.ChatInputCommandInteraction | Discord.Message;

    public readonly guild: Discord.Guild | null;
    public readonly guild_id: string | null;
    public readonly channel: Discord.TextBasedChannel | null;
    public readonly channel_id: string;
    public readonly member: Discord.GuildMember | Discord.APIInteractionGuildMember | null;
    public readonly user: Discord.User;

    private response: Discord.Message | Discord.InteractionResponse | null = null;
    private replied = false;
    private editing = false;

    // normal constructor
    constructor(name: string, reply_object: Discord.ChatInputCommandInteraction | Discord.Message, wheatley: Wheatley);
    // copy constructor - used for edit
    constructor(command: Command, name: string, reply_object: Discord.Message);
    // impl
    constructor(..._args: [string, Discord.ChatInputCommandInteraction | Discord.Message, Wheatley]
                        | [Command, string, Discord.Message]) {
        const args = is_string(_args[0]) ?
            [ "n", ..._args ] as ["n", string, Discord.ChatInputCommandInteraction | Discord.Message, Wheatley]
            : [ "c", ..._args ] as ["c", Command, string, Discord.Message];
        if(args[0] == "n") {
            // construct new command
            const [ _, name, reply_object, wheatley ] = args;
            this.name = name;
            this.reply_object = reply_object;
            this.wheatley = wheatley;
            if(reply_object instanceof Discord.ChatInputCommandInteraction) {
                this.guild = reply_object.guild;
                this.guild_id = reply_object.guildId;
                this.channel = reply_object.channel;
                this.channel_id = reply_object.channelId;
                this.member = reply_object.member;
                this.user = reply_object.user;
            } else {
                this.guild = reply_object.guild;
                this.guild_id = reply_object.guildId;
                this.channel = reply_object.channel;
                this.channel_id = reply_object.channelId;
                this.member = reply_object.member;
                this.user = reply_object.author;
            }
        } else if(args[0] == "c") { // eslint-disable-line @typescript-eslint/no-unnecessary-condition
            // construct from copy, used for edit
            const [ _, command, name, reply_object ] = args;
            this.name = name;
            this.wheatley = command.wheatley;
            this.reply_object = reply_object;
            this.guild = command.guild;
            this.guild_id = command.guild_id;
            this.channel = command.channel;
            this.channel_id = command.channel_id;
            this.member = command.member;
            this.user = command.user;
            this.response = command.response;
            assert(command.replied);
            assert(command.editing);
            this.replied = true;
            this.editing = true;
        } else {
            assert(false, "impossible");
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

    async get_member(guild_override?: Discord.Guild) {
        if(guild_override) {
            return await guild_override.members.fetch(this.user.id);
        } else if(this.member instanceof Discord.GuildMember) {
            return this.member;
        } else {
            return await (await this.get_guild()).members.fetch(this.user.id);
        }
    }

    async reply(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false
    ) {
        if(is_string(raw_message_options)) {
            raw_message_options = {
                content: raw_message_options
            };
        }
        const message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions = {
            deletable: true,
            allowedMentions: default_allowed_mentions,
            embeds: [],
            files: [],
            components: [],
            content: "",
            ...raw_message_options
        };
        message_options.ephemeral_if_possible =
            message_options.ephemeral_if_possible || positional_ephemeral_if_possible;
        message_options.should_text_reply =
            message_options.should_text_reply || positional_should_text_reply;

        assert(!this.replied || this.editing);
        if(this.editing) {
            assert(this.reply_object instanceof Discord.ChatInputCommandInteraction
                    == this.response instanceof Discord.InteractionResponse);
            assert(this.response);
            if(this.response instanceof Discord.InteractionResponse) {
                assert(this.reply_object instanceof Discord.ChatInputCommandInteraction);
                await this.reply_object.editReply({
                    ...message_options
                });
            } else {
                await this.response.edit(message_options);
            }
        } else {
            assert(this.response === null);
            if(this.reply_object instanceof Discord.ChatInputCommandInteraction) {
                this.response = await this.reply_object.reply({
                    ephemeral: !!message_options.ephemeral_if_possible,
                    ...message_options
                });
            } else {
                if(message_options.should_text_reply) {
                    this.response = await this.reply_object.reply(message_options);
                } else {
                    this.response = await this.reply_object.channel.send(message_options);
                }
            }
        }
        this.replied = true;
        this.editing = false;
    }

    is_slash() {
        return this.reply_object instanceof Discord.ChatInputCommandInteraction;
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

    get_or_forge_url() {
        if(this.reply_object instanceof Discord.Message) {
            return this.reply_object.url;
        } else {
            return `https://discord.com/channels/${this.guild_id}/${this.channel_id}/${forge_snowflake(Date.now())}`;
        }
    }

    async delete_invocation() {
        assert(this.reply_object instanceof Discord.Message);
        this.reply_object.delete();
    }

    async delete_replies_if_replied() {
        assert(!this.editing);
        if(this.replied) {
            assert(this.response !== null);
            if(this.response instanceof Discord.InteractionResponse) {
                assert(this.reply_object instanceof Discord.ChatInputCommandInteraction);
                await this.reply_object.deleteReply();
            } else {
                await this.response.delete();
            }
        }
    }

    set_editing() {
        this.editing = true;
    }

    get_reply() {
        assert(this.replied);
        return this.response;
    }
}
