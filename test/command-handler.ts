import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Discord from "discord.js";

import { BotButtonHandler, ButtonInteractionBuilder } from "../src/command-abstractions/button.js";
import { BotModalHandler, ModalInteractionBuilder } from "../src/command-abstractions/modal.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../src/command-abstractions/text-based-command-builder.js";
import { BotTextBasedCommand } from "../src/command-abstractions/text-based-command-descriptor.js";
import { TextBasedCommand } from "../src/command-abstractions/text-based-command.js";
import { CommandHandler } from "../src/command-handler.js";
import { Wheatley } from "../src/wheatley.js";

const guild_id = "1000000000";
const user = { bot: false, id: "2000000000", tag: "user" };
const command_reply_id = "6000000000";

function make_wheatley(has_permissions: boolean) {
    const check_permissions = vi.fn(async () => has_permissions);
    const critical_error = vi.fn();
    const wheatley = {
        client: { on: vi.fn() },
        guild: { id: guild_id },
        devmode_enabled: false,
        check_permissions,
        critical_error,
    } as unknown as Wheatley;
    return { wheatley, check_permissions, critical_error };
}

function fake_message(content: string, overrides: Record<string, unknown> = {}) {
    return {
        content,
        id: "5000000000",
        partial: false,
        type: Discord.MessageType.Default,
        author: user,
        guildId: guild_id,
        url: "https://discord.com/channels/x/y/z",
        ...overrides,
    } as unknown as Discord.Message;
}

// Has to be a real ChatInputCommandInteraction instance since the handler and make_url check instanceof
function fake_slash_interaction(
    command_name: string,
    values: Record<string, unknown>,
    subcommand: string | null = null,
) {
    const get_value = (title: string) => values[title] ?? null;
    return Object.assign(Object.create(Discord.ChatInputCommandInteraction.prototype), {
        commandName: command_name,
        user,
        guildId: guild_id,
        channelId: "3000000000",
        member: null,
        client: { guilds: { cache: new Discord.Collection() }, channels: { cache: new Discord.Collection() } },
        options: {
            getSubcommand: () => subcommand,
            getString: get_value,
            getNumber: get_value,
            getBoolean: get_value,
            getUser: get_value,
            getRole: get_value,
        },
        reply: vi.fn(),
    }) as Discord.ChatInputCommandInteraction;
}

// Fake for other interactions, which the handler dispatches on with the is* type guards
function fake_typed_interaction(kind: "button" | "modal" | "autocomplete", properties: Record<string, unknown>) {
    return {
        guildId: guild_id,
        user,
        replied: false,
        deferred: false,
        reply: vi.fn(),
        isChatInputCommand: () => false,
        isAutocomplete: () => kind === "autocomplete",
        isMessageContextMenuCommand: () => false,
        isUserContextMenuCommand: () => false,
        isModalSubmit: () => kind === "modal",
        isButton: () => kind === "button",
        ...properties,
    } as unknown as Discord.ButtonInteraction;
}

function discord_api_error(code: number) {
    return new Discord.DiscordAPIError({ message: "error", code }, code, 404, "DELETE", "", {});
}

function make_handler() {
    return vi.fn(async (..._args: unknown[]) => {});
}

// reply() is mocked, so record a reply by hand for the edit, delete, and reaction logic to find
function make_command_handler() {
    return vi.fn(async (...args: unknown[]) => {
        const command = args[0] as TextBasedCommand;
        command.replies.push({ id: command_reply_id } as Discord.Message);
        command.replied = true;
    });
}

function make_handlers() {
    return {
        echo: make_command_handler(),
        admin: make_command_handler(),
        sub: make_command_handler(),
        greet: make_command_handler(),
        version: make_command_handler(),
        search: make_command_handler(),
        button: make_handler(),
        plain_button: make_handler(),
        modal: make_handler(),
    };
}

type Handlers = ReturnType<typeof make_handlers>;

function make_commands(wheatley: Wheatley, handlers: Handlers) {
    const builders: (TextBasedCommandBuilder<any, true, true> | TextBasedCommandBuilder<any, true, false, true>)[] = [
        new TextBasedCommandBuilder("echo", EarlyReplyMode.none)
            .set_description("echo")
            .add_string_option({ title: "text", description: "text", required: true })
            .add_number_option({ title: "n", description: "n", required: false })
            .set_handler(handlers.echo),
        new TextBasedCommandBuilder("admin", EarlyReplyMode.none)
            .set_description("admin")
            .set_permissions(Discord.PermissionFlagsBits.Administrator)
            .set_handler(handlers.admin),
        new TextBasedCommandBuilder("parent", EarlyReplyMode.none)
            .set_description("parent")
            .add_subcommand(
                new TextBasedCommandBuilder("sub", EarlyReplyMode.none)
                    .set_description("sub")
                    .add_string_option({ title: "x", description: "x", required: true })
                    .set_handler(handlers.sub),
            ),
        new TextBasedCommandBuilder(["greet", "hi"], EarlyReplyMode.none)
            .set_description("greet")
            .set_handler(handlers.greet),
        new TextBasedCommandBuilder("version", EarlyReplyMode.none)
            .set_description("version")
            // Unanchored like the real duration regex
            .add_string_option({ title: "v", description: "v", required: true, regex: /\d+\.\d+/ })
            .set_handler(handlers.version),
        new TextBasedCommandBuilder("search", EarlyReplyMode.none)
            .set_description("search")
            .add_string_option({
                title: "query",
                description: "query",
                required: true,
                autocomplete: (partial: string) => [{ name: "x".repeat(150), value: `${partial}!` }],
            })
            .set_handler(handlers.search),
    ];
    const commands: Record<string, BotTextBasedCommand<unknown[]>> = {};
    for (const descriptor of builders.flatMap(builder => builder.to_command_descriptors(wheatley))) {
        commands[descriptor.name] = descriptor;
    }
    return commands;
}

function make_buttons_and_modals(handlers: Handlers) {
    const button = new ButtonInteractionBuilder("test-button")
        .add_string_metadata()
        .add_number_metadata()
        .add_boolean_metadata()
        .add_user_id_metadata()
        .set_handler(handlers.button);
    const plain_button = new ButtonInteractionBuilder("plain-button")
        .set_permissions(Discord.PermissionFlagsBits.Administrator)
        .set_handler(handlers.plain_button);
    const modal = new ModalInteractionBuilder("test-modal")
        .add_string_metadata()
        .add_number_metadata()
        .add_short_text_field("field", "Field")
        .set_handler(handlers.modal);
    return {
        button_handlers: {
            "test-button": button.build_handler(),
            "plain-button": plain_button.build_handler(),
        } as Record<string, BotButtonHandler<unknown[]>>,
        modal_handlers: { "test-modal": modal.build_handler() } as Record<string, BotModalHandler<unknown[]>>,
        button: button.build_button(),
        plain_button: plain_button.build_button(),
        modal: modal.build_modal(),
    };
}

function setup(has_permissions = true) {
    const { wheatley, check_permissions, critical_error } = make_wheatley(has_permissions);
    const handlers = make_handlers();
    const { button_handlers, modal_handlers, ...components } = make_buttons_and_modals(handlers);
    const command_handler = new CommandHandler(
        wheatley,
        make_commands(wheatley, handlers),
        button_handlers,
        modal_handlers,
        {},
    );
    // The event callbacks are private, so call them through an untyped handle
    const private_handler = command_handler as any;
    return {
        check_permissions,
        critical_error,
        handlers,
        components,
        command_handler,
        send: (message: Discord.Message) => private_handler.on_message(message) as Promise<void>,
        send_edit: (old_message: Discord.Message, new_message: Discord.Message) =>
            private_handler.on_message_update(old_message, new_message) as Promise<void>,
        send_delete: (message: Discord.Message) => private_handler.on_message_delete(message) as Promise<void>,
        send_interaction: (interaction: Discord.Interaction) =>
            private_handler.on_interaction(interaction) as Promise<void>,
        send_slash: (interaction: Discord.ChatInputCommandInteraction) =>
            private_handler.handle_slash_comand(interaction) as Promise<void>,
    };
}

function arguments_of(handler: ReturnType<typeof make_handler>, call = 0) {
    expect(handler.mock.calls.length, "handler call count").toBeGreaterThan(call);
    return handler.mock.calls[call].slice(1);
}

// Spies on the TextBasedCommand methods that would talk to Discord
let reply_spy: ReturnType<typeof vi.spyOn>;
let delete_replies_spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    reply_spy = vi.spyOn(TextBasedCommand.prototype, "reply").mockResolvedValue(undefined as any);
    delete_replies_spy = vi.spyOn(TextBasedCommand.prototype, "delete_replies_if_replied").mockResolvedValue();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("CommandHandler text dispatch", () => {
    it("should dispatch with parsed arguments", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!echo hello world 5"));
        expect(handlers.echo).toHaveBeenCalledOnce();
        expect(arguments_of(handlers.echo)).toEqual(["hello world", 5]);
    });

    it("should dispatch with optional arguments missing", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!echo   hello  "));
        expect(arguments_of(handlers.echo)).toEqual(["hello", null]);
    });

    it("should ignore unknown commands, bots, other guilds, and non-commands", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!unknown hello"));
        await send(fake_message("!echo hello", { author: { bot: true, id: "1", tag: "bot" } }));
        await send(fake_message("!echo hello", { guildId: "9999999999" }));
        await send(fake_message("echo hello"));
        await send(fake_message("! echo hello"));
        expect(handlers.echo).not.toHaveBeenCalled();
    });

    it("should match command names exactly", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!Echo hello"));
        await send(fake_message("!echohello"));
        expect(handlers.echo).not.toHaveBeenCalled();
    });

    it("should dispatch every alias", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!greet"));
        await send(fake_message("!hi"));
        expect(handlers.greet).toHaveBeenCalledTimes(2);
    });

    it("should route subcommands", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!parent sub some value"));
        expect(arguments_of(handlers.sub)).toEqual(["some value"]);
    });

    it("should reply with command info for a missing or unknown subcommand", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!parent"));
        await send(fake_message("!parent nope"));
        expect(handlers.sub).not.toHaveBeenCalled();
        expect(reply_spy).toHaveBeenCalledTimes(2);
    });

    it("should not dispatch without permissions", async () => {
        const { check_permissions, handlers, send } = setup(false);
        await send(fake_message("!admin"));
        expect(check_permissions).toHaveBeenCalledOnce();
        expect(handlers.admin).not.toHaveBeenCalled();
    });

    it("should dispatch with permissions", async () => {
        const { handlers, send } = setup(true);
        await send(fake_message("!admin"));
        expect(handlers.admin).toHaveBeenCalledOnce();
    });

    it("should not dispatch when parsing fails", async () => {
        const { handlers, send } = setup();
        await send(fake_message("!admin unexpected"));
        expect(handlers.admin).not.toHaveBeenCalled();
        expect(reply_spy).toHaveBeenCalledOnce();
    });
});

describe("CommandHandler message edits", () => {
    const original = fake_message("!echo hello 1");

    it("should re-dispatch an edited command with the new arguments", async () => {
        const { handlers, send, send_edit } = setup();
        await send(original);
        await send_edit(original, fake_message("!echo goodbye 2"));
        expect(handlers.echo).toHaveBeenCalledTimes(2);
        expect(arguments_of(handlers.echo, 1)).toEqual(["goodbye", 2]);
    });

    it("should ignore edits that don't change the content", async () => {
        const { handlers, send, send_edit } = setup();
        await send(original);
        await send_edit(original, fake_message("!echo hello 1"));
        expect(handlers.echo).toHaveBeenCalledOnce();
    });

    it("should delete replies when edited into a non-command", async () => {
        const { handlers, send, send_edit } = setup();
        await send(original);
        await send_edit(original, fake_message("just a message"));
        expect(handlers.echo).toHaveBeenCalledOnce();
        expect(delete_replies_spy).toHaveBeenCalledOnce();
    });

    it("should refuse to edit a command that replied in multiple parts", async () => {
        const edit_spy = vi.spyOn(TextBasedCommand.prototype, "edit").mockResolvedValue();
        const follow_up_spy = vi.spyOn(TextBasedCommand.prototype, "delete_follow_ups").mockResolvedValue();
        const { handlers, send, send_edit } = setup();
        await send(original);
        (handlers.echo.mock.calls[0][0] as TextBasedCommand).replies.push({ id: "6000000001" } as Discord.Message);
        await send_edit(original, fake_message("!echo goodbye 2"));
        expect(handlers.echo).toHaveBeenCalledOnce();
        expect(edit_spy.mock.calls[0][0]).toContain("replied in multiple parts");
        expect(follow_up_spy).toHaveBeenCalledOnce();
    });
});

describe("CommandHandler deletes and reactions", () => {
    const trigger = fake_message("hello");

    function fake_reaction(message_id: string, user_ids: string[], emoji = "❌") {
        return {
            message: { guildId: guild_id, id: message_id },
            emoji: { name: emoji },
            users: { cache: new Discord.Collection(user_ids.map(id => [id, { id }])), remove: vi.fn() },
        } as unknown as Discord.MessageReaction;
    }

    function fake_bot_reply(delete_result: Promise<unknown> = Promise.resolve()) {
        const delete_reply = vi.fn(() => delete_result);
        return { reply: { id: "7000000000", delete: delete_reply } as unknown as Discord.Message, delete_reply };
    }

    it("should delete a command's replies when its trigger is deleted", async () => {
        const { send, send_delete } = setup();
        const command = fake_message("!echo hello");
        await send(command);
        await send_delete(command);
        await send_delete(command);
        expect(delete_replies_spy).toHaveBeenCalledOnce();
    });

    it("should delete a non-command reply when its trigger is deleted", async () => {
        const { command_handler, send_delete } = setup();
        const { reply, delete_reply } = fake_bot_reply();
        command_handler.register_non_command_bot_reply(trigger, reply);
        await send_delete(trigger);
        expect(delete_reply).toHaveBeenCalledOnce();
    });

    it("should ignore a non-command reply that was already deleted", async () => {
        const { critical_error, command_handler, send_delete } = setup();
        command_handler.register_non_command_bot_reply(
            trigger,
            fake_bot_reply(Promise.reject(discord_api_error(10008))).reply,
        );
        await send_delete(trigger);
        expect(critical_error).not.toHaveBeenCalled();
    });

    it("should report other errors deleting a non-command reply", async () => {
        const { critical_error, command_handler, send_delete } = setup();
        command_handler.register_non_command_bot_reply(trigger, fake_bot_reply(Promise.reject(new Error())).reply);
        await send_delete(trigger);
        expect(critical_error).toHaveBeenCalledOnce();
    });

    it("should delete a command's replies when the trigger user reacts with ❌", async () => {
        const { command_handler, send } = setup();
        await send(fake_message("!echo hello"));
        await command_handler.on_reaction_add(fake_reaction(command_reply_id, [user.id]));
        expect(delete_replies_spy).toHaveBeenCalledOnce();
    });

    it("should remove ❌ reactions from other users", async () => {
        const { command_handler, send } = setup();
        await send(fake_message("!echo hello"));
        const reaction = fake_reaction(command_reply_id, ["9000000000"]);
        await command_handler.on_reaction_add(reaction);
        expect(delete_replies_spy).not.toHaveBeenCalled();
        expect(vi.mocked(reaction.users).remove.mock.calls).toEqual([[{ id: "9000000000" }]]);
    });

    it("should ignore other reactions", async () => {
        const { command_handler, send } = setup();
        await send(fake_message("!echo hello"));
        await command_handler.on_reaction_add(fake_reaction(command_reply_id, [user.id], "👍"));
        expect(delete_replies_spy).not.toHaveBeenCalled();
    });

    it("should delete a non-command reply when the trigger user reacts with ❌", async () => {
        const { command_handler } = setup();
        const { reply, delete_reply } = fake_bot_reply();
        command_handler.register_non_command_bot_reply(trigger, reply);
        await command_handler.on_reaction_add(fake_reaction(reply.id, [user.id]));
        expect(delete_reply).toHaveBeenCalledOnce();
    });
});

describe("CommandHandler buttons and modals", () => {
    const fake_button = (custom_id: string) => fake_typed_interaction("button", { customId: custom_id });
    const fake_modal = (custom_id: string) => fake_typed_interaction("modal", { customId: custom_id });
    // Contains the separator, the escape character, and text that already looks escaped
    const tricky_string = "a:b 100% %3A %25";

    it("should round-trip button arguments through the custom id", async () => {
        const { handlers, components, send_interaction } = setup();
        await send_interaction(fake_button(components.button.generate_custom_id("hello", 42, true, user.id)));
        expect(arguments_of(handlers.button)).toEqual(["hello", 42, true, user.id]);
    });

    it("should round-trip empty strings", async () => {
        const { handlers, components, send_interaction } = setup();
        await send_interaction(fake_button(components.button.generate_custom_id("", 0, false, user.id)));
        expect(arguments_of(handlers.button)).toEqual(["", 0, false, user.id]);
    });

    it("should round-trip strings containing the separator", async () => {
        const { handlers, components, send_interaction } = setup();
        await send_interaction(fake_button(components.button.generate_custom_id(tricky_string, 1, true, user.id)));
        expect(arguments_of(handlers.button)).toEqual([tricky_string, 1, true, user.id]);
    });

    it("should dispatch a button with no arguments", async () => {
        const { handlers, components, send_interaction } = setup();
        expect(components.plain_button.generate_custom_id()).toBe("plain-button");
        await send_interaction(fake_button("plain-button"));
        expect(arguments_of(handlers.plain_button)).toEqual([]);
    });

    it("should check button permissions", async () => {
        const { handlers, send_interaction } = setup(false);
        const interaction = fake_button("plain-button");
        await send_interaction(interaction);
        expect(handlers.plain_button).not.toHaveBeenCalled();
        expect(vi.mocked(interaction).reply.mock.calls.length).toBe(1);
    });

    it("should report a button custom id with the wrong number of arguments", async () => {
        const { critical_error, handlers, send_interaction } = setup();
        const interaction = fake_button("test-button:hello");
        await send_interaction(interaction);
        expect(handlers.button).not.toHaveBeenCalled();
        expect(vi.mocked(interaction).reply.mock.calls.length).toBe(1);
        expect(critical_error).toHaveBeenCalledOnce();
    });

    it("should ignore unknown buttons", async () => {
        const { critical_error, send_interaction } = setup();
        await send_interaction(fake_button("unknown-button:1"));
        expect(critical_error).not.toHaveBeenCalled();
    });

    it("should round-trip modal arguments through the custom id", async () => {
        const { handlers, components, send_interaction } = setup();
        await send_interaction(fake_modal(components.modal.generate_custom_id("hello", 3)));
        expect(arguments_of(handlers.modal)).toEqual(["hello", 3]);
    });

    it("should round-trip modal strings containing the separator", async () => {
        const { handlers, components, send_interaction } = setup();
        await send_interaction(fake_modal(components.modal.generate_custom_id(tricky_string, 3)));
        expect(arguments_of(handlers.modal)).toEqual([tricky_string, 3]);
    });
});

describe("CommandHandler autocomplete", () => {
    function fake_autocomplete(respond: ReturnType<typeof vi.fn>) {
        return fake_typed_interaction("autocomplete", {
            commandName: "search",
            options: { getSubcommand: () => null, getFocused: () => ({ name: "query", value: "abc" }) },
            respond,
        });
    }

    it("should respond with suggestions truncated to 100 characters", async () => {
        const { send_interaction } = setup();
        const respond = vi.fn();
        await send_interaction(fake_autocomplete(respond));
        expect(respond.mock.calls).toEqual([[[{ name: "x".repeat(100), value: "abc!" }]]]);
    });

    it("should not report an expired autocomplete interaction", async () => {
        const { critical_error, send_interaction } = setup();
        await send_interaction(fake_autocomplete(vi.fn().mockRejectedValue(discord_api_error(10062))));
        expect(critical_error).not.toHaveBeenCalled();
    });
});

describe("CommandHandler slash dispatch", () => {
    it("should dispatch with option values", async () => {
        const { handlers, send_slash } = setup();
        await send_slash(fake_slash_interaction("echo", { text: "hello world", n: 5 }));
        expect(arguments_of(handlers.echo)).toEqual(["hello world", 5]);
    });

    it("should pass null for missing optional options", async () => {
        const { handlers, send_slash } = setup();
        await send_slash(fake_slash_interaction("echo", { text: "hello" }));
        expect(arguments_of(handlers.echo)).toEqual(["hello", null]);
    });

    it("should route subcommands", async () => {
        const { handlers, send_slash } = setup();
        await send_slash(fake_slash_interaction("parent", { x: "some value" }, "sub"));
        expect(arguments_of(handlers.sub)).toEqual(["some value"]);
    });

    it("should validate string options against their regex", async () => {
        const { handlers, send_slash } = setup();
        await send_slash(fake_slash_interaction("version", { v: "abc" }));
        await send_slash(fake_slash_interaction("version", { v: "abc 1.2" }));
        expect(handlers.version).not.toHaveBeenCalled();
        expect(reply_spy).toHaveBeenCalledTimes(2);
        await send_slash(fake_slash_interaction("version", { v: " 1.2 " }));
        expect(arguments_of(handlers.version)).toEqual([" 1.2 "]);
    });

    it("should not dispatch when a required option is missing", async () => {
        const { critical_error, handlers, send_slash } = setup();
        await send_slash(fake_slash_interaction("echo", {}));
        expect(handlers.echo).not.toHaveBeenCalled();
        expect(critical_error).toHaveBeenCalledOnce();
    });

    it("should not dispatch without permissions", async () => {
        const { handlers, send_slash } = setup(false);
        const interaction = fake_slash_interaction("admin", {});
        await send_slash(interaction);
        expect(handlers.admin).not.toHaveBeenCalled();
        expect(vi.mocked(interaction).reply.mock.calls.length).toBe(1);
    });
});
