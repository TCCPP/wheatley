import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { forge_snowflake } from "../components/snowflake.js";
import { unwrap } from "../utils/misc.js";
import { is_string } from "../utils/strings.js";
import { Wheatley } from "../wheatley.js";
import { BotTextBasedCommand } from "./text-based-command-descriptor.js";

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

export class TextBasedCommand {
    public readonly name: string;
    public command_descriptor: BotTextBasedCommand<unknown[]>;
    private readonly wheatley: Wheatley;
    private readonly reply_object: Discord.ChatInputCommandInteraction | Discord.Message;

    public guild: Discord.Guild | null;
    public readonly guild_id: string | null;
    public channel: Discord.TextBasedChannel | null;
    public readonly channel_id: string;

    public member: Discord.GuildMember | Discord.APIInteractionGuildMember | null;
    public readonly user: Discord.User;

    public response: Discord.Message | Discord.InteractionResponse | null = null;
    public replied = false;
    private editing = false;

    // normal constructor
    constructor(
        name: string,
        command: BotTextBasedCommand<unknown[]>,
        reply_object: Discord.ChatInputCommandInteraction | Discord.Message,
        wheatley: Wheatley,
    );
    // copy constructor - used for edit
    constructor(
        command: TextBasedCommand,
        name: string,
        command_descriptor: BotTextBasedCommand<unknown[]>,
        reply_object: Discord.Message,
    );
    // impl
    constructor(
        ..._args:
            | [string, BotTextBasedCommand<unknown[]>, Discord.ChatInputCommandInteraction | Discord.Message, Wheatley]
            | [TextBasedCommand, string, BotTextBasedCommand<unknown[]>, Discord.Message]
    ) {
        const args = is_string(_args[0])
            ? (["n", ..._args] as [
                  "n",
                  string,
                  BotTextBasedCommand<unknown[]>,
                  Discord.ChatInputCommandInteraction | Discord.Message,
                  Wheatley,
              ])
            : (["c", ..._args] as ["c", TextBasedCommand, string, BotTextBasedCommand<unknown[]>, Discord.Message]);
        if (args[0] == "n") {
            // construct new command
            const [_, name, command, reply_object, wheatley] = args;
            this.name = name;
            this.command_descriptor = command;
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
            const [_, command, name, command_descriptor, reply_object] = args;
            this.name = name;
            this.command_descriptor = command_descriptor;
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

    get is_editing() {
        return this.editing;
    }

    get_reply() {
        assert(this.replied);
        return this.response;
    }
}
