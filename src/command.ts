import { strict as assert } from "assert";

import * as Discord from "discord.js";
import { ContextMenuCommandBuilder } from "discord.js";
import { forge_snowflake } from "./components/snowflake.js";

import { unwrap, is_string, critical_error } from "./utils.js";
import { Wheatley } from "./wheatley.js";

export const ApplicationCommandTypeUser = 2;
export const ApplicationCommandTypeMessage = 3;

export type TextBasedCommandOptionType = "string" | "user";

export type TextBasedCommandOption = {
    title: string;
    description: string;
    required?: boolean; // TODO: Currently not implemented for text commands
    regex?: RegExp; // TODO: Should it not apply to slash command fields
    autocomplete?: (partial: string, command_name: string) => { name: string; value: string }[];
};

type Append<T extends unknown[], U> = [...T, U];

type ConditionalOptional<C extends true | false, T> = C extends true ? T : T | undefined;

type MoreThanOne<T> = [T, T, ...T[]];

export type CommandAbstractionReplyOptions = {
    // default: false
    should_text_reply?: boolean;
    // default: false
    ephemeral_if_possible?: boolean;
    // default: true
    deletable?: boolean;
};

const default_allowed_mentions: Discord.MessageMentionOptions = {
    parse: ["users"],
};

// Command builder stuff

export abstract class CommandBuilder<HasHandler extends boolean = false, HandlerArgs extends unknown[] = []> {
    handler: ConditionalOptional<HasHandler, (...args: HandlerArgs) => any>;
}

export class TextBasedCommandBuilder<
    Args extends unknown[] = [],
    HasDescriptions extends boolean = false,
    HasHandler extends boolean = false,
> extends CommandBuilder<HasHandler, [TextBasedCommand, ...Args]> {
    readonly names: string[];
    descriptions: ConditionalOptional<HasDescriptions, string[]>;
    options = new Discord.Collection<string, TextBasedCommandOption & { type: TextBasedCommandOptionType }>();
    slash_config: boolean[];
    permissions: undefined | bigint = undefined;

    constructor(names: string | MoreThanOne<string>) {
        super();
        this.names = Array.isArray(names) ? names : [names];
        this.slash_config = new Array(this.names.length).fill(true);
    }

    set_description(raw_descriptions: string | MoreThanOne<string>): TextBasedCommandBuilder<Args, true, HasHandler> {
        const descriptions = Array.isArray(raw_descriptions) ? raw_descriptions : [raw_descriptions];
        if (descriptions.length == this.names.length) {
            this.descriptions = descriptions;
        } else {
            assert(descriptions.length == 1);
            this.descriptions = new Array(this.names.length).fill(descriptions[0]);
        }
        return this as unknown as TextBasedCommandBuilder<Args, true, HasHandler>;
    }

    add_string_option(
        option: TextBasedCommandOption,
    ): TextBasedCommandBuilder<Append<Args, string>, HasDescriptions, HasHandler> {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "string",
        });
        return this as unknown as TextBasedCommandBuilder<Append<Args, string>, HasDescriptions, HasHandler>;
    }

    add_user_option(
        option: Omit<TextBasedCommandOption, "autocomplete" | "regex">,
    ): TextBasedCommandBuilder<Append<Args, Discord.User>, HasDescriptions, HasHandler> {
        assert(!this.options.has(option.title));
        this.options.set(option.title, {
            ...option,
            type: "user",
        });
        return this as unknown as TextBasedCommandBuilder<Append<Args, Discord.User>, HasDescriptions, HasHandler>;
    }

    set_handler(
        handler: (x: TextBasedCommand, ...args: Args) => any,
    ): TextBasedCommandBuilder<Args, HasDescriptions, true> {
        this.handler = handler;
        return this as unknown as TextBasedCommandBuilder<Args, HasDescriptions, true>;
    }

    set_slash(...config: boolean[]) {
        if (config.length == this.names.length) {
            this.slash_config = config;
        } else {
            assert(config.length == 1);
            this.slash_config = new Array(this.names.length).fill(config[0]);
        }
        return this;
    }

    set_permissions(permissions: bigint) {
        this.permissions = permissions;
        return this;
    }

    // TODO: to_command_descriptors?
}

export abstract class OtherCommandBuilder<
    HasHandler extends boolean = false,
    HandlerArgs extends unknown[] = [],
> extends CommandBuilder<HasHandler, HandlerArgs> {
    // returns botcommand and djs command to register, if applicable
    abstract to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown | undefined];
}

export class MessageContextMenuCommandBuilder<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.MessageContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.MessageContextMenuCommandInteraction) => any,
    ): MessageContextMenuCommandBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuCommandBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotCommand<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BotCommand(this.name, this.handler) as ConditionalOptional<HasHandler, BotCommand<any>>,
                new ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeMessage),
            ];
        }
    }
}

export class UserContextMenuCommandBuilder<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.UserContextMenuCommandInteraction]
> {
    // TODO: Permissions?

    constructor(public readonly name: string) {
        super();
    }

    set_handler(
        handler: (x: Discord.UserContextMenuCommandInteraction) => any,
    ): MessageContextMenuCommandBuilder<true> {
        this.handler = handler;
        return this as unknown as MessageContextMenuCommandBuilder<true>;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotCommand<any>>, unknown] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotCommand<any>>, undefined];
        } else {
            // TODO: Permissions?
            return [
                new BotCommand(this.name, this.handler) as ConditionalOptional<HasHandler, BotCommand<any>>,
                new ContextMenuCommandBuilder().setName(this.name).setType(ApplicationCommandTypeUser),
            ];
        }
    }
}

export class ModalHandler<HasHandler extends boolean = false> extends OtherCommandBuilder<
    HasHandler,
    [Discord.ModalSubmitInteraction, ...string[]]
> {
    readonly name: string;
    readonly fields: string[];

    constructor(modal: Discord.ModalBuilder, handler: (x: Discord.ModalSubmitInteraction, ...args: string[]) => any) {
        super();
        assert(modal.data.custom_id);
        this.name = unwrap(modal.data.custom_id);
        this.fields = modal.components
            .map(row => row.components.map(component => unwrap(component.data.custom_id)))
            .flat();
        this.handler = handler;
    }

    override to_command_descriptors(): [ConditionalOptional<HasHandler, BotModalHandler>, undefined] {
        if (!this.handler) {
            return [undefined as ConditionalOptional<HasHandler, BotModalHandler>, undefined];
        } else {
            return [
                new BotModalHandler(this.name, this as ModalHandler<true>) as ConditionalOptional<
                    HasHandler,
                    BotModalHandler
                >,
                undefined,
            ];
        }
    }
}

// Command descriptors for the bot to store

export class BotCommand<Args extends unknown[] = []> {
    constructor(
        public readonly name: string,
        public readonly handler: (...args: Args) => any,
    ) {}
}

export class BotTextBasedCommand<Args extends unknown[] = []> extends BotCommand<[TextBasedCommand, ...Args]> {
    options = new Discord.Collection<string, TextBasedCommandOption & { type: TextBasedCommandOptionType }>();

    constructor(
        name: string,
        public readonly description: string | undefined,
        public readonly slash: boolean,
        public readonly permissions: undefined | bigint,
        builder: TextBasedCommandBuilder<Args, true, true>,
    ) {
        super(name, builder.handler);
        this.options = builder.options;
    }
}

export class BotModalHandler extends BotCommand<[Discord.ModalSubmitInteraction, ...string[]]> {
    fields: string[];

    constructor(name: string, modal: ModalHandler<true>) {
        super(name, modal.handler);
        this.fields = modal.fields;
    }
}

// Command abstractions themselves

export class Command {}

export class TextBasedCommand extends Command {
    public readonly name: string;
    private readonly wheatley: Wheatley;
    private readonly reply_object: Discord.ChatInputCommandInteraction | Discord.Message;

    public guild: Discord.Guild | null;
    public readonly guild_id: string | null;
    public channel: Discord.TextBasedChannel | null;
    public readonly channel_id: string;

    public member: Discord.GuildMember | Discord.APIInteractionGuildMember | null;
    public readonly user: Discord.User;

    private response: Discord.Message | Discord.InteractionResponse | null = null;
    public replied = false;
    private editing = false;

    // normal constructor
    constructor(name: string, reply_object: Discord.ChatInputCommandInteraction | Discord.Message, wheatley: Wheatley);
    // copy constructor - used for edit
    constructor(command: TextBasedCommand, name: string, reply_object: Discord.Message);
    // impl
    constructor(
        ..._args:
            | [string, Discord.ChatInputCommandInteraction | Discord.Message, Wheatley]
            | [TextBasedCommand, string, Discord.Message]
    ) {
        super();
        const args = is_string(_args[0])
            ? (["n", ..._args] as ["n", string, Discord.ChatInputCommandInteraction | Discord.Message, Wheatley])
            : (["c", ..._args] as ["c", TextBasedCommand, string, Discord.Message]);
        if (args[0] == "n") {
            // construct new command
            const [_, name, reply_object, wheatley] = args;
            this.name = name;
            this.reply_object = reply_object;
            this.wheatley = wheatley;
            if (reply_object instanceof Discord.ChatInputCommandInteraction) {
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
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        } else if (args[0] == "c") {
            // construct from copy, used for edit
            const [_, command, name, reply_object] = args;
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
        if (this.guild) {
            return this.guild;
        } else {
            if (this.guild_id) {
                return (this.guild = await this.wheatley.client.guilds.fetch(this.guild_id));
            } else {
                throw Error("No guild");
            }
        }
    }

    async get_channel(): Promise<Discord.TextBasedChannel> {
        if (this.channel) {
            return this.channel;
        } else {
            return (this.channel = <Discord.TextBasedChannel>(
                unwrap(await (await this.get_guild()).channels.fetch(this.channel_id))
            ));
        }
    }

    async get_member(guild_override?: Discord.Guild) {
        if (guild_override) {
            return await guild_override.members.fetch(this.user.id);
        } else if (this.member instanceof Discord.GuildMember) {
            return this.member;
        } else {
            return (this.member = await (await this.get_guild()).members.fetch(this.user.id));
        }
    }

    async reply(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
    ) {
        if (is_string(raw_message_options)) {
            raw_message_options = {
                content: raw_message_options,
            };
        }
        const message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions = {
            deletable: true,
            allowedMentions: default_allowed_mentions,
            embeds: [],
            files: [],
            components: [],
            content: "",
            ...raw_message_options,
        };
        message_options.ephemeral_if_possible =
            message_options.ephemeral_if_possible || positional_ephemeral_if_possible;
        message_options.should_text_reply = message_options.should_text_reply || positional_should_text_reply;

        assert(!this.replied || this.editing);
        if (this.editing) {
            assert(
                this.reply_object instanceof Discord.ChatInputCommandInteraction ==
                    this.response instanceof Discord.InteractionResponse,
            );
            assert(this.response);
            if (this.response instanceof Discord.InteractionResponse) {
                assert(this.reply_object instanceof Discord.ChatInputCommandInteraction);
                await this.reply_object.editReply({
                    ...message_options,
                });
            } else {
                await this.response.edit(message_options);
            }
        } else {
            assert(this.response === null);
            if (this.reply_object instanceof Discord.ChatInputCommandInteraction) {
                this.response = await this.reply_object.reply({
                    ephemeral: !!message_options.ephemeral_if_possible,
                    ...message_options,
                });
            } else {
                if (message_options.should_text_reply) {
                    this.response = await this.reply_object.reply(message_options);
                } else {
                    this.response = await this.reply_object.channel.send(message_options);
                }
            }
        }
        this.replied = true;
        this.editing = false;
    }

    async followUp(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
    ) {
        // TODO: Duplicate
        if (is_string(raw_message_options)) {
            raw_message_options = {
                content: raw_message_options,
            };
        }
        const message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions = {
            deletable: true,
            allowedMentions: default_allowed_mentions,
            embeds: [],
            files: [],
            components: [],
            content: "",
            ...raw_message_options,
        };
        message_options.ephemeral_if_possible =
            message_options.ephemeral_if_possible || positional_ephemeral_if_possible;
        message_options.should_text_reply = message_options.should_text_reply || positional_should_text_reply;
        /// -----
        assert(this.replied && !this.editing);
        // TODO: Better handling for this kind of thing
        if (this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            this.response = await this.reply_object.followUp({
                ephemeral: !!message_options.ephemeral_if_possible,
                ...message_options,
            });
        } else {
            if (message_options.should_text_reply) {
                this.response = await this.reply_object.reply(message_options);
            } else {
                this.response = await this.reply_object.channel.send(message_options);
            }
        }
    }

    async edit(raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions)) {
        this.editing = true;
        await this.reply(raw_message_options);
    }

    is_slash() {
        return this.reply_object instanceof Discord.ChatInputCommandInteraction;
    }

    async react(emoji: string, ephemeral_if_possible = false) {
        if (this.reply_object instanceof Discord.ChatInputCommandInteraction) {
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
        if (this.reply_object instanceof Discord.Message) {
            return this.reply_object.url;
        } else {
            return `https://discord.com/channels/${this.guild_id}/${this.channel_id}/${forge_snowflake(Date.now())}`;
        }
    }

    async delete_invocation() {
        assert(this.reply_object instanceof Discord.Message);
        await this.reply_object.delete();
    }

    async delete_replies_if_replied() {
        // note can be called while editing if edited from a command to a non-command
        if (this.replied) {
            assert(this.response !== null);
            if (this.response instanceof Discord.InteractionResponse) {
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
