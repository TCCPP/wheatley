import * as Discord from "discord.js";

import { describe, expect, it, vi } from "vitest";

import VoiceTake from "../src/modules/wheatley/components/moderation/voice-take.js";

function createMember({ id, roleIds = [], channel = null }: { id: string; roleIds?: string[]; channel?: any }) {
    const roles = new Set(roleIds);

    return {
        id,
        user: { bot: false },
        roles: {
            cache: {
                has: (roleId: string) => roles.has(roleId),
            },
            remove: vi.fn().mockResolvedValue(undefined),
            add: vi.fn().mockResolvedValue(undefined),
        },
        permissions: {
            has: () => false,
        },
        voice: { channel },
    };
}

function createVoiceChannel(members: any[]) {
    return {
        members: new Discord.Collection(members.map(member => [member.id, member])),
    };
}

function createVoiceTake(member: any, force_voice_permissions_update = vi.fn().mockResolvedValue(true)) {
    return Object.assign(Object.create(VoiceTake.prototype), {
        wheatley: {
            try_fetch_guild_member: vi.fn().mockResolvedValue(member),
            force_voice_permissions_update,
        },
        roles: {
            voice: { id: "voice-role" },
            voice_moderator: { id: "voice-moderator-role" },
        },
    });
}

describe("voice take refreshes", () => {
    it("forces a refresh when applying a voice take in a channel without a voice moderator", async () => {
        const member = createMember({ id: "target" });
        const channel = createVoiceChannel([member]);
        member.voice.channel = channel;

        const force_voice_permissions_update = vi.fn().mockResolvedValue(true);
        const component = createVoiceTake(member, force_voice_permissions_update);

        await component.apply_moderation({ user: member.id, user_name: "Target" });

        expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "voice-role" }));
        expect(force_voice_permissions_update).toHaveBeenCalledWith(member);
    });

    it("does not force a refresh when a voice moderator is already present", async () => {
        const voice_moderator = createMember({
            id: "voice-moderator",
            roleIds: ["voice-moderator-role"],
        });
        const member = createMember({ id: "target" });
        const channel = createVoiceChannel([member, voice_moderator]);
        member.voice.channel = channel;

        const force_voice_permissions_update = vi.fn().mockResolvedValue(true);
        const component = createVoiceTake(member, force_voice_permissions_update);

        await component.apply_moderation({ user: member.id, user_name: "Target" });

        expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "voice-role" }));
        expect(force_voice_permissions_update).not.toHaveBeenCalled();
    });

    it("forces a refresh again when removing a voice take", async () => {
        const member = createMember({ id: "target" });
        const channel = createVoiceChannel([member]);
        member.voice.channel = channel;

        const force_voice_permissions_update = vi.fn().mockResolvedValue(true);
        const component = createVoiceTake(member, force_voice_permissions_update);

        await component.remove_moderation({ user: member.id, user_name: "Target" });

        expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ id: "voice-role" }));
        expect(force_voice_permissions_update).toHaveBeenCalledWith(member);
    });
});
