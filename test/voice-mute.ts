import { describe, expect, it, vi } from "vitest";

import VoiceMute from "../src/modules/wheatley/components/moderation/voice-mute.js";

function create_member(id: string) {
    return {
        id,
        user: { tag: `${id}#0000` },
        roles: {
            remove: vi.fn().mockResolvedValue(undefined),
            add: vi.fn().mockResolvedValue(undefined),
        },
        voice: { channel: {} },
    };
}

function create_voice_mute(member: any, force_voice_permissions_update: any) {
    return Object.assign(Object.create(VoiceMute.prototype), {
        wheatley: {
            try_fetch_guild_member: vi.fn().mockResolvedValue(member),
            force_voice_permissions_update,
        },
        roles: {
            voice_muted: { id: "voice-muted-role" },
        },
    });
}

describe("voice mute refreshes", () => {
    it("still applies the moderation when the refresh fails", async () => {
        const member = create_member("target");

        const force_voice_permissions_update = vi.fn().mockRejectedValue(new Error("disconnected"));
        const component = create_voice_mute(member, force_voice_permissions_update);

        await expect(component.apply_moderation({ user: member.id, user_name: "Target" })).resolves.toBeUndefined();

        expect(member.roles.add).toHaveBeenCalledWith(expect.objectContaining({ id: "voice-muted-role" }));
        expect(force_voice_permissions_update).toHaveBeenCalledWith(member);
    });

    it("still removes the moderation when the refresh fails", async () => {
        const member = create_member("target");

        const force_voice_permissions_update = vi.fn().mockRejectedValue(new Error("disconnected"));
        const component = create_voice_mute(member, force_voice_permissions_update);

        await expect(component.remove_moderation({ user: member.id, user_name: "Target" })).resolves.toBeUndefined();

        expect(member.roles.remove).toHaveBeenCalledWith(expect.objectContaining({ id: "voice-muted-role" }));
        expect(force_voice_permissions_update).toHaveBeenCalledWith(member);
    });
});
