import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { escape_regex } from "./utils";

export type CommandOptionType = "string";

export type CommandOption = {
    title: string;
    description: string;
    required?: boolean;
    autocomplete?: (x: string) => { name: string, value: string }[];
};

type Append<T extends unknown[], U> = [...T, U];

type ConditionalOptional<C extends true | false, T> = C extends true ? T : T | undefined;

export class CommandBuilder<Args extends unknown[] = [], HasHandler extends boolean = false> {
    description = "";
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: ConditionalOptional<HasHandler, (x: Command, ...args: Args) => any>;

    constructor(readonly name: string) {}

    set_description(description: string) {
        this.description = description;
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
    description = "";
    options = new Discord.Collection<string, CommandOption & {type: CommandOptionType}>();
    handler: (x: Command, ...args: Args) => any;

    constructor(builder: CommandBuilder<Args, true>) {
        this.description = builder.description;
        this.options = builder.options;
        this.handler = builder.handler;
    }
}

export type CommandAbstractionReplyOptions = {
    should_text_reply?: boolean;
    ephemeral_if_possible?: boolean;
}

const default_allowed_mentions: Discord.MessageMentionOptions = {
    parse: ["users"]
};

export class Command {
    constructor(
        public readonly name: string,
        public readonly invoker: Discord.GuildMember | Discord.APIInteractionGuildMember | null,
        public readonly channel: Discord.TextBasedChannel | null,
        private readonly reply_object: Discord.ChatInputCommandInteraction | Discord.Message
    ) {}

    async reply(message_options: Discord.BaseMessageOptions & CommandAbstractionReplyOptions) {
        if(this.reply_object instanceof Discord.ChatInputCommandInteraction) {
            await this.reply_object.reply({
                ephemeral: !!message_options.ephemeral_if_possible,
                allowedMentions: default_allowed_mentions,
                ...message_options
            });
        } else {
            if(message_options.should_text_reply) {
                await this.reply_object.reply({
                    allowedMentions: default_allowed_mentions,
                    ...message_options
                });
            } else {
                await this.reply_object.channel.send({
                    allowedMentions: default_allowed_mentions,
                    ...message_options
                });
            }
        }
    }
}
