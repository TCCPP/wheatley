import { describe, expect, it, vi } from "vitest";
import * as Discord from "discord.js";

import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
    TextBasedCommandOptionType,
} from "../src/command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../src/command-abstractions/text-based-command.js";
import { duration_regex } from "../src/modules/wheatley/components/moderation/moderation-common.js";
import { Wheatley } from "../src/wheatley.js";

const alice_id = "1111111111";
const bob_id = "2222222222";
const alice = { id: alice_id };
const bob = { id: bob_id };
const replied_author = { id: "3333333333" };
const moderators_role = { id: "4000000001", name: "Moderators" };
const cpp_expert_role = { id: "4000000002", name: "C++ Expert" };
// Shares a prefix with Moderators and comes after it in the cache
const moderators_lead_role = { id: "4000000003", name: "Moderators Lead" };
// Ends in punctuation and is a prefix of C++ Expert
const cpp_role = { id: "4000000004", name: "C++" };
const roles = [
    { id: "4000000000", name: "@everyone" },
    moderators_role,
    cpp_expert_role,
    moderators_lead_role,
    cpp_role,
];

const fake_wheatley = {
    client: {
        users: {
            fetch: async (id: string) => {
                if (id === alice_id || id === bob_id) {
                    return { id };
                } else {
                    throw new Error("Unknown user");
                }
            },
        },
    },
    guild: { roles: { cache: new Discord.Collection(roles.map(role => [role.id, role])) } },
    fetch_message_reply: vi.fn(async () => ({ author: replied_author })),
    critical_error: vi.fn(),
} as unknown as Wheatley;

type Builder = TextBasedCommandBuilder<any, true, true> | TextBasedCommandBuilder<any, true, false, true>;

type OptionSpec = {
    type: TextBasedCommandOptionType;
    required: boolean;
    regex?: RegExp;
    choices?: { name: string; value: unknown }[];
};

const required = (type: TextBasedCommandOptionType, extra: Partial<OptionSpec> = {}): OptionSpec => ({
    type,
    required: true,
    ...extra,
});
const optional = (type: TextBasedCommandOptionType, extra: Partial<OptionSpec> = {}): OptionSpec => ({
    type,
    required: false,
    ...extra,
});

// The info embed sent when the first required argument is missing includes the command description
const command_info = "test command";

function command(...specs: OptionSpec[]): Builder {
    let builder: any = new TextBasedCommandBuilder("test", EarlyReplyMode.none).set_description(command_info);
    for (const [i, { type, ...options }] of specs.entries()) {
        builder = builder[`add_${type}_option`]({ title: `arg${i}`, description: `arg${i}`, ...options });
    }
    return builder.set_handler(async () => {}) as Builder;
}

async function parse(builder: Builder, body: string, message_type = Discord.MessageType.Default) {
    const descriptor = builder.to_command_descriptors(fake_wheatley)[0];
    const reply = vi.fn();
    const command_obj = { reply, command_descriptor: descriptor } as unknown as TextBasedCommand;
    const message = { type: message_type } as unknown as Discord.Message;
    const result = await descriptor.parse_text_arguments(command_obj, message, body);
    return { result, reply };
}

function reply_description(reply: ReturnType<typeof vi.fn>) {
    expect(reply).toHaveBeenCalledOnce();
    return (reply.mock.calls[0][0].embeds[0] as Discord.EmbedBuilder).data.description ?? "";
}

function signature(specs: OptionSpec[]) {
    return specs.map(spec => (spec.required ? `<${spec.type}>` : `[${spec.type}]`)).join(" ");
}

const version_regex = /^\d+\.\d+/;
const colors = { choices: [{ name: "Red", value: "red" }] };
// The real moderation duration regex, which unlike version_regex isn't anchored
const duration = { regex: duration_regex };
// Option shapes of the moderation commands
const mute_options = [required("user"), optional("string", duration), optional("string")];
const massban_options = [required("users"), optional("string", duration), optional("string")];
const rolepersist_options = [required("user"), required("role"), optional("string", duration), optional("string")];
const purge_user_options = [required("user"), required("string", duration), optional("boolean")];

// [options, body, expected parsed arguments]
const parse_cases: [OptionSpec[], string, unknown[]][] = [
    // single options
    [[], "", []],
    [[required("string")], "hello world  foo", ["hello world  foo"]],
    [[optional("string")], "", [null]],
    [[required("number")], "42", [42]],
    [[optional("number")], "", [null]],
    [[required("boolean")], "true", [true]],
    [[required("boolean")], "FALSE", [false]],
    [[optional("boolean")], "", [null]],
    [[required("user")], `<@${alice_id}>`, [alice]],
    [[required("user")], alice_id, [alice]],
    [[optional("user")], "", [null]],
    [[required("users")], `<@${alice_id}> ${bob_id}`, [[alice, bob]]],
    [[optional("users")], "", [null]],
    [[required("role")], "moderators", [moderators_role]],
    [[required("role")], "c++ expert", [cpp_expert_role]],
    // regex and choices
    [[required("string", { regex: version_regex }), optional("string")], "1.2 the rest", ["1.2", "the rest"]],
    [[optional("string", { regex: version_regex }), optional("string")], "the rest", [null, "the rest"]],
    [[required("string", colors)], "red", ["red"]],
    [[required("number", { choices: [{ name: "one", value: 1 }] })], "1", [1]],
    // something followed by a general string
    [[required("boolean"), required("string")], "true some text", [true, "some text"]],
    [[optional("boolean"), required("string")], "some text", [null, "some text"]],
    [[optional("boolean"), required("string")], "truest friend", [null, "truest friend"]],
    [[required("number"), required("string")], "5 some text", [5, "some text"]],
    [[optional("number"), required("string")], "some text", [null, "some text"]],
    [[optional("number"), required("string")], "3rd place", [null, "3rd place"]],
    [[required("user"), required("string")], `<@${alice_id}> some reason`, [alice, "some reason"]],
    [[optional("user"), required("string")], "some reason", [null, "some reason"]],
    [[required("users"), required("string")], `<@${alice_id}> <@${bob_id}> being rude`, [[alice, bob], "being rude"]],
    [[optional("users"), required("string")], "some reason", [null, "some reason"]],
    [[required("role"), required("string")], "Moderators please help", [moderators_role, "please help"]],
    [[optional("role"), required("string")], "ping the moderators", [null, "ping the moderators"]],
    // a general string followed by something
    [[required("string"), required("string")], "foo bar baz", ["foo", "bar baz"]],
    [[required("string"), optional("string")], "foo", ["foo", null]],
    [[required("string"), required("number")], "foo bar 5", ["foo bar", 5]],
    [[required("string"), optional("number")], "foo bar", ["foo bar", null]],
    [[required("string"), required("boolean")], "foo bar True", ["foo bar", true]],
    [[required("string"), optional("boolean")], "some text", ["some text", null]],
    [[required("string"), required("user")], `some reason <@${alice_id}>`, ["some reason", alice]],
    [[required("string"), optional("user")], "some text", ["some text", null]],
    [[required("string"), required("users")], `some text <@${alice_id}> ${bob_id}`, ["some text", [alice, bob]]],
    [[required("string"), required("role")], "hello Moderators", ["hello", moderators_role]],
    // non-string pairs
    [[required("number"), required("number")], "1 2", [1, 2]],
    [[required("boolean"), required("boolean")], "true FALSE", [true, false]],
    [[required("number"), required("boolean")], "5 true", [5, true]],
    [[required("boolean"), required("number")], "false 7", [false, 7]],
    [[required("user"), required("user")], `<@${alice_id}> <@${bob_id}>`, [alice, bob]],
    [[required("user"), required("number")], `<@${alice_id}> 10`, [alice, 10]],
    [[required("number"), required("user")], `10 <@${alice_id}>`, [10, alice]],
    [[required("users"), required("number")], `<@${alice_id}> ${bob_id} 10`, [[alice, bob], 10]],
    [[required("role"), required("user")], `C++ Expert <@${alice_id}>`, [cpp_expert_role, alice]],
    [[optional("number"), required("boolean")], "true", [null, true]],
    [[optional("boolean"), required("number")], "7", [null, 7]],
    // three options
    [[required("user"), required("number"), required("string")], `<@${alice_id}> 30 rude`, [alice, 30, "rude"]],
    [[required("string"), required("number"), required("string")], "foo bar 5 baz qux", ["foo bar", 5, "baz qux"]],
    [
        [required("users"), required("boolean"), required("string")],
        `<@${alice_id}> <@${bob_id}> true some reason`,
        [[alice, bob], true, "some reason"],
    ],
    [
        [required("role"), required("boolean"), required("string")],
        "C++ Expert false some note",
        [cpp_expert_role, false, "some note"],
    ],
    [[optional("boolean"), optional("number"), required("string")], "hello world", [null, null, "hello world"]],
    [[optional("boolean"), optional("number"), required("string")], "true 3 hi there", [true, 3, "hi there"]],
    [[optional("boolean"), optional("number"), required("string")], "4 hi", [null, 4, "hi"]],
    // mention formats and role names
    [[required("user")], `<@!${alice_id}>`, [alice]],
    [[required("users")], `<@!${alice_id}> <@${bob_id}>`, [[alice, bob]]],
    [[required("users")], `<@${alice_id}><@${bob_id}>`, [[alice, bob]]],
    [[required("role")], `<@&${moderators_role.id}>`, [moderators_role]],
    [[required("role"), required("string")], `<@&${moderators_role.id}> please help`, [moderators_role, "please help"]],
    [[required("role")], "moderators lead", [moderators_lead_role]],
    [[required("role"), required("string")], "C++ please help", [cpp_role, "please help"]],
    [[required("role"), required("string")], "C++ Expert please help", [cpp_expert_role, "please help"]],
    // whitespace
    [[required("string")], "line one\nline two", ["line one\nline two"]],
    [[required("number"), required("string")], "5\n```cpp\nint x;\n```", [5, "```cpp\nint x;\n```"]],
    [[required("string"), required("number")], "foo\n5", ["foo", 5]],
    [[required("user"), required("string")], `<@${alice_id}>\tsome reason`, [alice, "some reason"]],
    [[required("number"), required("number")], "1\n\n2", [1, 2]],
    // short ids aren't treated as users
    [[optional("user"), required("string")], "123456789 text", [null, "123456789 text"]],
    // moderation commands
    [mute_options, `<@${alice_id}>`, [alice, null, null]],
    [mute_options, `<@${alice_id}> 2h`, [alice, "2h", null]],
    [mute_options, `<@${alice_id}> 2 hours`, [alice, "2 hours", null]],
    [mute_options, `<@${alice_id}> perm`, [alice, "perm", null]],
    [mute_options, `<@${alice_id}> 2h being rude`, [alice, "2h", "being rude"]],
    [mute_options, `<@${alice_id}> perm being rude`, [alice, "perm", "being rude"]],
    [mute_options, `<@${alice_id}> being rude`, [alice, null, "being rude"]],
    [mute_options, `<@${alice_id}> permanently rude`, [alice, null, "permanently rude"]],
    [mute_options, `<@${alice_id}> spamming in 3 channels`, [alice, null, "spamming in 3 channels"]],
    [mute_options, `<@${alice_id}> being rude perm`, [alice, null, "being rude perm"]],
    [massban_options, `<@${alice_id}> <@${bob_id}> 1d raid`, [[alice, bob], "1d", "raid"]],
    [massban_options, `<@${alice_id}> <@${bob_id}> raid with 5 accounts`, [[alice, bob], null, "raid with 5 accounts"]],
    [rolepersist_options, `<@${alice_id}> Moderators 1w abuse`, [alice, moderators_role, "1w", "abuse"]],
    [rolepersist_options, `<@${alice_id}> Moderators`, [alice, moderators_role, null, null]],
    [
        rolepersist_options,
        `<@${alice_id}> Moderators abuse of 2 channels`,
        [alice, moderators_role, null, "abuse of 2 channels"],
    ],
    [purge_user_options, `<@${alice_id}> 1h`, [alice, "1h", null]],
    [purge_user_options, `<@${alice_id}> 1h true`, [alice, "1h", true]],
];

// [options, body, text the error reply should contain]
const error_cases: [OptionSpec[], string, string][] = [
    [[required("string")], "", command_info],
    [[required("number")], "-5", command_info],
    [[required("role")], "nonexistent", command_info],
    [[required("string", { regex: version_regex }), optional("string")], "the rest", command_info],
    [[required("string"), required("number")], "foo", `Required argument "arg1" not found\n\n**Usage:**`],
    [[required("string", colors)], "green", "Invalid argument choice green"],
    [[required("string", colors)], "Red", "Invalid argument choice Red"],
    [[required("number", { choices: [{ name: "one", value: 1 }] })], "2", "Invalid argument choice 2"],
    [[required("user")], "9999999999", "Unable to find user"],
    [[required("users")], `<@${alice_id}> 9999999999 <@${bob_id}>`, "Unable to find user"],
    [[required("user")], "123456789", command_info],
    [purge_user_options, `<@${alice_id}> recently`, `Required argument "arg1" not found`],
    [[required("role")], "<@&9999999999>", "Unable to find role"],
    [[], "extra", "Unexpected parameters provided"],
    [[required("number")], "5 extra", "Unexpected parameters provided"],
    [[required("number")], "1.5", "Unexpected parameters provided"],
    // Current behavior for ambiguous free text, pinned so that changes to it are deliberate
    [[required("string"), required("number")], "version 2 released 5", "Unexpected parameters provided"],
    [[required("string"), required("user")], `ask <@${alice_id}> about <@${bob_id}>`, "Unexpected parameters provided"],
    [[optional("string"), required("number")], "5", `Required argument "arg1" not found`],
    // A number of snowflake length after a users option is read as another user
    [[required("users"), required("number")], `<@${alice_id}> 1234567890`, "Unable to find user"],
];

describe("parsing", () => {
    for (const [specs, body, expected] of parse_cases) {
        it(`${signature(specs)} ${JSON.stringify(body)}`, async () => {
            const { result, reply } = await parse(command(...specs), body);
            expect(reply).not.toHaveBeenCalled();
            expect(result).toEqual(expected);
        });
    }

    it("should allow trailing junk when enabled", async () => {
        const builder = command(required("number")).set_allow_trailing_junk(true);
        expect((await parse(builder, "5 extra")).result).toEqual([5]);
    });
});

describe("parse errors", () => {
    for (const [specs, body, expected] of error_cases) {
        it(`${signature(specs)} ${JSON.stringify(body)}`, async () => {
            const { result, reply } = await parse(command(...specs), body);
            expect(result).toBeUndefined();
            expect(reply_description(reply)).toContain(expected);
        });
    }
});

describe("replies", () => {
    const parse_reply = (body: string, ...specs: OptionSpec[]) =>
        parse(command(...specs), body, Discord.MessageType.Reply);

    it("should fall back to the replied-to author", async () => {
        expect((await parse_reply("", required("user"))).result).toEqual([replied_author]);
        expect((await parse_reply("reason", optional("user"), required("string"))).result).toEqual([
            replied_author,
            "reason",
        ]);
    });

    it("should prefer an explicit user over the replied-to author", async () => {
        expect((await parse_reply(alice_id, required("user"))).result).toEqual([alice]);
        expect((await parse_reply(`${alice_id} reason`, optional("user"), required("string"))).result).toEqual([
            alice,
            "reason",
        ]);
    });

    it("should report a failure to fetch the reply", async () => {
        const error = new Error("fetch failed");
        vi.mocked(fake_wheatley).fetch_message_reply.mockRejectedValueOnce(error);
        const { result, reply } = await parse_reply("reason", optional("user"), required("string"));
        expect(result).toBeUndefined();
        expect(reply_description(reply)).toBe("Error fetching reply");
        expect(vi.mocked(fake_wheatley).critical_error.mock.lastCall).toEqual([error]);
    });
});

describe("get_usage", () => {
    it("should format required and optional arguments", () => {
        const descriptor = command(required("string"), optional("number")).to_command_descriptors(fake_wheatley)[0];
        expect(descriptor.get_usage()).toBe("`/⁠test <arg0> [arg1]`");
    });

    it("should list subcommand usages", () => {
        const builder = new TextBasedCommandBuilder("parent", EarlyReplyMode.none)
            .set_description("parent")
            .add_subcommand(
                new TextBasedCommandBuilder("foo", EarlyReplyMode.none)
                    .set_description("foo")
                    .add_string_option({ title: "x", description: "x", required: true })
                    .set_handler(async () => {}),
            )
            .add_subcommand(
                new TextBasedCommandBuilder("bar", EarlyReplyMode.none)
                    .set_description("bar")
                    .set_handler(async () => {}),
            );
        const descriptor = builder.to_command_descriptors(fake_wheatley)[0];
        expect(descriptor.get_usage()).toBe("`/⁠parent foo <x>`\n`/⁠parent bar`");
    });
});
