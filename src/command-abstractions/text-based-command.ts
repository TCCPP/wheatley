import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { unwrap } from "../utils/misc.js";
import { is_string } from "../utils/strings.js";
import { Wheatley } from "../wheatley.js";
import { BotTextBasedCommand } from "./text-based-command-descriptor.js";
import { forge_snowflake } from "../utils/discord.js";

export type CommandAbstractionReplyOptions = {
    // default: false
    should_text_reply?: boolean;
    // default: false
    ephemeral_if_possible?: boolean;
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

    public replies: (Discord.Message | Discord.InteractionResponse)[] = [];
    public replied = false;
    // editing flag indicates a reply should overwrite a previous reply, used by the command editing system
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
            // Subsuming an existing command with multiple replies would be challenging and confusing
            assert(command.replies.length == 1);
            this.replies = command.replies;
            assert(command.replied);
            assert(command.editing);
            this.replied = true;
            this.editing = true;
        } else {
            assert(false, "impossible");
        }
    }

    // utilities / accessors

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

    // interaction logic

    private async do_edit(
        message_options: Discord.InteractionEditReplyOptions | Discord.MessageEditOptions,
        allow_partial_edit = false,
    ) {
        if (allow_partial_edit) {
            assert(this.replies.length > 0 && this.replied);
        } else {
            assert(this.replies.length === 1 && this.replied);
        }
        assert(
            this.reply_object instanceof Discord.ChatInputCommandInteraction ==
                this.replies[0] instanceof Discord.InteractionResponse,
        );
        if (this.replies[0] instanceof Discord.InteractionResponse) {
            assert(this.reply_object instanceof Discord.ChatInputCommandInteraction);
            await this.reply_object.editReply({
                ...message_options,
            });
        } else {
            await this.replies[0].edit(message_options);
        }
    }

    private async do_reply(
        message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions,
        strict: boolean,
    ) {
        assert(this.replied || this.replies.length === 0);
        if (this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            if (this.replied && !strict) {
                this.replies.push(
                    await this.reply_object.followUp({
                        ephemeral: !!message_options.ephemeral_if_possible,
                        ...message_options,
                    }),
                );
            } else {
                this.replies.push(
                    await this.reply_object.reply({
                        ephemeral: !!message_options.ephemeral_if_possible,
                        ...message_options,
                    }),
                );
            }
        } else {
            if (message_options.should_text_reply) {
                this.replies.push(await this.reply_object.reply(message_options));
            } else {
                assert(!(this.reply_object.channel instanceof Discord.PartialGroupDMChannel));
                this.replies.push(await this.reply_object.channel.send(message_options));
            }
        }
    }

    make_message_options(
        raw_message_options:
            | string
            | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions)
            | Discord.MessageEditOptions,
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
    ) {
        if (is_string(raw_message_options)) {
            raw_message_options = {
                content: raw_message_options,
            };
        }
        const message_options: (Discord.BaseMessageOptions | Discord.MessageEditOptions) &
            CommandAbstractionReplyOptions = {
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

        return message_options;
    }

    // core interaction interface

    // replies to a text command or slash command
    // if the edit flag is set, it edits the previous response
    // otherwise if the edit flag is not set and a reply has already been sent it does a followup reply
    // if strict is set a followup will not be done, it will ensure only one reply is sent
    async reply(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
        strict = true,
    ) {
        const message_options = this.make_message_options(
            raw_message_options,
            positional_ephemeral_if_possible,
            positional_should_text_reply,
        );

        if (strict) {
            assert(!this.replied || this.editing);
        }
        if (this.editing) {
            await this.do_edit(message_options);
            this.editing = false;
        } else {
            await this.do_reply(
                {
                    ...message_options,
                    content: message_options.content ?? undefined,
                },
                strict,
            );
            this.replied = true;
        }
    }

    async followUp(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
    ) {
        assert(this.replied);
        await this.reply(raw_message_options, positional_ephemeral_if_possible, positional_should_text_reply, false);
    }

    async replyOrFollowUp(
        raw_message_options: string | (Discord.BaseMessageOptions & CommandAbstractionReplyOptions),
        positional_ephemeral_if_possible = false,
        positional_should_text_reply = false,
    ) {
        await this.reply(raw_message_options, positional_ephemeral_if_possible, positional_should_text_reply, false);
    }

    async edit(raw_message_options: string | Discord.MessageEditOptions, allow_partial = false) {
        assert(allow_partial || this.replies.length == 1); // It doesn't make sense to edit a multi-message reply
        const message_options = this.make_message_options(raw_message_options, false, false);
        await this.do_edit(message_options, allow_partial);
        this.editing = false;
    }

    is_slash() {
        return this.reply_object instanceof Discord.ChatInputCommandInteraction;
    }

    async get_reply_target() {
        if (this.reply_object instanceof Discord.Message) {
            if (this.reply_object.type === Discord.MessageType.Reply) {
                try {
                    const reply_message = await this.wheatley.fetch_message_reply(this.reply_object);
                    return reply_message;
                } catch (e) {
                    this.wheatley.critical_error(e);
                }
            }
        }
        return null;
    }

    // get_text_command_content() {
    //     assert(this.reply_object instanceof Discord.Message);
    //     return this.reply_object.content;
    // }

    get_message_object() {
        assert(this.reply_object instanceof Discord.Message);
        return this.reply_object;
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
            assert(this.replies.length > 0);
            if (this.replies[0] instanceof Discord.InteractionResponse) {
                assert(this.reply_object instanceof Discord.ChatInputCommandInteraction);
                await this.reply_object.deleteReply();
            } else {
                const res = await Promise.allSettled(this.replies.map(reply => reply.delete()));
                for (const item of res) {
                    if (item.status === "rejected") {
                        const e = item.reason;
                        if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
                            // Unknown message, presumably already deleted
                        } else {
                            throw e;
                        }
                    }
                }
            }
        }
    }

    async delete_follow_ups() {
        // note can be called while editing if edited from a command to a non-command
        if (this.replied) {
            assert(this.replies.length > 0);
            const res = await Promise.allSettled(this.replies.slice(1).map(reply => reply.delete()));
            for (const item of res) {
                if (item.status === "rejected") {
                    const e = item.reason;
                    if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
                        // Unknown message, presumably already deleted
                    } else {
                        throw e;
                    }
                }
            }
        }
    }

    set_editing() {
        this.editing = true;
    }

    get is_editing() {
        return this.editing;
    }

    get_replies() {
        assert(this.replied);
        return this.replies;
    }

    get_command_invocation_snowflake() {
        return this.reply_object.id;
    }
}
