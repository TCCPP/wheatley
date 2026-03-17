import * as Discord from "discord.js";

import { describe, expect, it, vi } from "vitest";

import VoiceUpdate from "../src/modules/wheatley/components/moderation/voice-update.js";
import { exclude_bots, perform_voice_update, select_everyone } from "../src/utils/voice-update.js";

function createMember({
    id,
    bot = false,
    roleIds = [],
    permissionBits = [],
    channel = null,
}: {
    id: string;
    bot?: boolean;
    roleIds?: string[];
    permissionBits?: bigint[];
    channel?: any;
}) {
    const roles = new Set(roleIds);
    const permissions = new Set(permissionBits);

    return {
        id,
        user: { bot },
        roles: {
            cache: {
                has: (roleId: string) => roles.has(roleId),
            },
        },
        permissions: {
            has: (permission: bigint) => permissions.has(permission),
        },
        voice: { channel },
    };
}

function createVoiceChannel(members: any[], name = "Office Hours") {
    return {
        name,
        isVoiceBased: () => true,
        members: new Discord.Collection(members.map(member => [member.id, member])),
    };
}

describe("voice update", () => {
    it("refreshes only affected non-bot members in affected-user mode", async () => {
        const force_voice_permissions_update = vi.fn().mockResolvedValue(true);
        const wheatley = {
            guild: { afkChannel: { id: "afk" } },
            components: { has: (name: string) => name === "PermissionManager" },
            force_voice_permissions_update,
            is_tccpp_like: () => true,
        };

        const channel = createVoiceChannel([]);
        const caller = createMember({
            id: "caller",
            permissionBits: [Discord.PermissionFlagsBits.MoveMembers],
            channel,
        });
        const missing_voice = createMember({ id: "missing-voice", channel });
        const has_voice = createMember({ id: "has-voice", roleIds: ["voice-role"], channel });
        const bot_member = createMember({ id: "bot", bot: true, channel });
        channel.members = new Discord.Collection([
            [caller.id, caller],
            [missing_voice.id, missing_voice],
            [has_voice.id, has_voice],
            [bot_member.id, bot_member],
        ]);

        const reply = vi.fn().mockResolvedValue(undefined);
        const command = {
            get_member: vi.fn().mockResolvedValue(caller),
            reply,
        };

        const component = Object.assign(Object.create(VoiceUpdate.prototype), {
            wheatley,
            utilities: {
                resolve_role: vi.fn().mockReturnValue({ id: "voice-role" }),
            },
        });

        await component["handle_update"](command, null);

        expect(force_voice_permissions_update).toHaveBeenCalledTimes(1);
        expect(force_voice_permissions_update).toHaveBeenCalledWith(missing_voice);
        expect(reply).toHaveBeenCalledWith({
            content: "Refreshed voice permissions for 1 affected member(s) in Office Hours.",
            should_text_reply: true,
        });
    });

    it("requires all outside TCCPP when affected-user mode is unavailable", async () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const caller = createMember({
            id: "caller",
            permissionBits: [Discord.PermissionFlagsBits.MoveMembers],
            channel: createVoiceChannel([]),
        });
        const component = Object.assign(Object.create(VoiceUpdate.prototype), {
            wheatley: {
                is_tccpp_like: () => false,
            },
        });

        await component["handle_update"](
            {
                get_member: vi.fn().mockResolvedValue(caller),
                reply,
            },
            null,
        );

        expect(reply).toHaveBeenCalledOnce();
        expect(reply.mock.calls[0][0].embeds[0].data.description).toContain("Specify `all: true` to refresh everyone.");
    });
});

describe("perform_voice_update", () => {
    it("reports succeeded, skipped, and failed refreshes after exclusions", async () => {
        const caller = createMember({
            id: "caller",
            permissionBits: [Discord.PermissionFlagsBits.MoveMembers],
        });
        const succeeds = createMember({ id: "succeeds" });
        const skips = createMember({ id: "skips" });
        const fails = createMember({ id: "fails" });
        const bot_member = createMember({ id: "bot", bot: true });
        const channel_moderator = createMember({
            id: "channel-moderator",
            permissionBits: [Discord.PermissionFlagsBits.MoveMembers],
        });
        const channel = createVoiceChannel([caller, succeeds, skips, fails, bot_member, channel_moderator]);

        const force_voice_permissions_update = vi.fn(async (member: { id: string }) => {
            if (member.id === "succeeds") {
                return true;
            }
            if (member.id === "skips") {
                return false;
            }
            throw new Error("refresh failed");
        });

        const result = await perform_voice_update(
            {
                guild: {} as any,
                caller: { ...caller, voice: { channel } } as any,
                channel: channel as any,
                wheatley: {
                    guild: { afkChannel: { id: "afk" } },
                    force_voice_permissions_update,
                } as any,
            },
            exclude_bots(select_everyone),
        );

        expect(force_voice_permissions_update).toHaveBeenCalledTimes(3);
        expect(result).toEqual({
            succeeded: 1,
            failed: 1,
            skipped: 1,
            total: 3,
            afk_missing: false,
        });
    });
});
