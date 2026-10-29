import { describe, expect, it, vi } from "vitest";
import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { TextBasedCommand } from "../src/command-abstractions/text-based-command.js";
import { ModerationComponent } from "../src/modules/wheatley/components/moderation/moderation-common.js";
import Rolepersist from "../src/modules/wheatley/components/moderation/rolepersist.js";
import {
    basic_moderation,
    moderation_entry,
    moderation_type,
} from "../src/modules/wheatley/components/moderation/schemata.js";

function setup(type: moderation_type = "rolepersist") {
    const events: string[] = [];
    const user = { id: "2000000000", displayName: "Pancake", avatarURL: () => null } as unknown as Discord.User;
    const moderator = { id: "3000000000", displayName: "Moderator" } as Discord.User;
    const apply = vi.fn(() => {
        events.push("apply");
        return Promise.resolve();
    });
    const member = { roles: { highest: { position: 1 }, add: apply } };
    const issuer = { displayName: moderator.displayName, roles: { highest: { position: 10 } } };
    const insert = vi.fn((_entry: moderation_entry) => {
        events.push("persist");
        return Promise.resolve({ insertedId: new mongo.ObjectId() });
    });
    const notify = vi.fn((_channel: unknown, _user: Discord.User, _message: Discord.MessageCreateOptions) => {
        events.push("notify");
        return Promise.resolve(true);
    });
    const critical_error = vi.fn();
    const fetch_user = vi.fn().mockResolvedValue(user);
    const emit = vi.fn();
    const component = Object.assign(
        Object.create(type === "rolepersist" ? Rolepersist.prototype : ModerationComponent.prototype),
        {
            wheatley: {
                user: { id: "8000000000" },
                guild: {
                    name: "Test guild",
                    members: { fetch: vi.fn().mockResolvedValue(issuer) },
                    roles: {
                        everyone: { permissions: new Discord.PermissionsBitField() },
                        fetch: vi.fn().mockResolvedValue({ permissions: new Discord.PermissionsBitField() }),
                    },
                    channels: { cache: new Discord.Collection() },
                },
                client: { users: { fetch: fetch_user } },
                try_fetch_guild_member: vi.fn((requested: Discord.User | string) => {
                    const requested_id = typeof requested === "string" ? requested : requested.id;
                    return Promise.resolve(requested_id === moderator.id ? issuer : member);
                }),
                emoji: { error: "❌", success: "✅", me: "🤖" },
                critical_error,
                event_hub: { emit },
            },
            roles: { no_voice: { id: "7000000000" } },
            database: { moderations: { insertOne: insert } },
            sleep_list: { insert: vi.fn() },
            channels: {
                staff_action_log: { send: vi.fn().mockResolvedValue(undefined) },
                public_action_log: { send: vi.fn().mockResolvedValue(undefined) },
                rules: {},
            },
            notification_threads: { notify_user_with_thread_fallback: notify },
            check_for_recent_duplicate: vi.fn().mockResolvedValue(null),
            increment_case_id: vi.fn().mockResolvedValue(1),
        },
    ) as ModerationComponent;
    Object.defineProperty(component, "ring_red_telephone_button", {
        value: { generate_custom_id: () => "moderation:1" },
    });
    if (type !== "rolepersist") {
        Object.defineProperties(component, {
            type: { value: type },
            past_participle: { value: type === "mute" ? "muted" : type },
        });
        component.apply_moderation = apply;
    }
    const reply = vi.fn().mockResolvedValue(undefined);
    const reply_or_follow_up = vi.fn().mockResolvedValue(undefined);
    const command = {
        user: moderator,
        get_member: vi.fn().mockResolvedValue(issuer),
        get_or_forge_url: () => null,
        is_slash: () => true,
        reply,
        replyOrFollowUp: reply_or_follow_up,
    } as unknown as TextBasedCommand;
    const moderation: basic_moderation =
        type === "rolepersist" ? { type, role: "9000000000", role_name: "Restricted" } : { type };
    const issue = () => component.moderation_issue_handler(command, user, "1s", "Test reason", moderation);
    return {
        component,
        user,
        moderator,
        command,
        moderation,
        issue,
        apply,
        insert,
        notify,
        events,
        reply,
        reply_or_follow_up,
        fetch_user,
        emit,
        critical_error,
    };
}

describe("moderation notification ordering", () => {
    it("does not notify after a failed role assignment", async () => {
        const fixture = setup();
        fixture.apply.mockRejectedValue(new Error("Role assignment failed"));
        await fixture.issue();
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.insert).not.toHaveBeenCalled();
        expect(fixture.reply_or_follow_up).toHaveBeenCalledOnce();
        expect(fixture.reply).not.toHaveBeenCalled();
    });

    it("does not notify when saving the moderation fails", async () => {
        const fixture = setup();
        fixture.insert.mockRejectedValue(new Error("Moderation insert failed"));
        await fixture.issue();
        expect(fixture.apply).toHaveBeenCalledOnce();
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.reply_or_follow_up).toHaveBeenCalledOnce();
        expect(fixture.reply).not.toHaveBeenCalled();
    });

    it("applies and saves a rolepersist before notifying", async () => {
        const fixture = setup();
        await fixture.issue();
        expect(fixture.events).toEqual(["apply", "persist", "notify"]);
        expect(fixture.reply).toHaveBeenCalledOnce();
        expect(fixture.reply_or_follow_up).not.toHaveBeenCalled();
    });

    it.each([1, 2])("still notifies when audit user fetch %s fails", async fetch_number => {
        const fixture = setup();
        const failure = new Error("Audit user fetch failed");
        if (fetch_number === 2) {
            fixture.fetch_user.mockResolvedValueOnce(fixture.user);
        }
        fixture.fetch_user.mockRejectedValueOnce(failure);
        await fixture.issue();
        expect(fixture.apply).toHaveBeenCalledOnce();
        expect(fixture.insert).toHaveBeenCalledOnce();
        expect(fixture.notify).toHaveBeenCalledOnce();
        expect(fixture.reply).toHaveBeenCalledOnce();
        expect(fixture.reply_or_follow_up).not.toHaveBeenCalled();
        expect(fixture.critical_error).toHaveBeenCalledExactlyOnceWith(failure);
        expect(fixture.emit).toHaveBeenCalledOnce();
    });

    it("still notifies when a moderation event listener throws", async () => {
        const fixture = setup();
        const failure = new Error("Moderation listener failed");
        fixture.emit.mockImplementation(() => {
            throw failure;
        });
        await fixture.issue();
        expect(fixture.apply).toHaveBeenCalledOnce();
        expect(fixture.insert).toHaveBeenCalledOnce();
        expect(fixture.notify).toHaveBeenCalledOnce();
        expect(fixture.reply).toHaveBeenCalledOnce();
        expect(fixture.reply_or_follow_up).not.toHaveBeenCalled();
        expect(fixture.critical_error).toHaveBeenCalledExactlyOnceWith(failure);
    });

    it.each(["unavailable", "throws"])("keeps a successful moderation when notification %s", async failure => {
        const fixture = setup();
        if (failure === "throws") {
            fixture.notify.mockRejectedValue(new Error("Notification failed"));
        } else {
            fixture.notify.mockResolvedValue(false);
        }
        await fixture.issue();
        expect(fixture.apply).toHaveBeenCalledOnce();
        expect(fixture.insert).toHaveBeenCalledOnce();
        expect(fixture.reply).toHaveBeenCalledOnce();
        expect(fixture.reply_or_follow_up).not.toHaveBeenCalled();
        const reply = fixture.reply.mock.calls[0][0] as { embeds: Discord.EmbedBuilder[] };
        expect(reply.embeds[0].data.description).toContain("Couldn't notify user");
    });

    it("notifies automatic mutes only after successful issuance", async () => {
        const fixture = setup("mute");
        fixture.apply.mockRejectedValueOnce(new Error("Mute failed"));
        await expect(
            fixture.component.issue_moderation_internal(
                fixture.user,
                fixture.moderator,
                1000,
                null,
                fixture.moderation,
            ),
        ).rejects.toThrow("Mute failed");
        expect(fixture.notify).not.toHaveBeenCalled();
        expect(fixture.insert).not.toHaveBeenCalled();
        await fixture.component.issue_moderation_internal(
            fixture.user,
            fixture.moderator,
            1000,
            null,
            fixture.moderation,
        );
        expect(fixture.events).toEqual(["apply", "persist", "notify"]);
    });

    it("applies and saves each target before its multi-user notification", async () => {
        const fixture = setup("mute");
        const other_user = { ...fixture.user, id: "4000000000" } as Discord.User;
        await fixture.component.moderation_multi_issue_handler(
            fixture.command,
            [fixture.user, other_user],
            "1s",
            null,
            fixture.moderation,
        );
        expect(fixture.events).toEqual(["apply", "persist", "notify", "apply", "persist", "notify"]);
        expect(fixture.notify.mock.calls.map(call => call[1].id)).toEqual([fixture.user.id, other_user.id]);
    });

    it("stops issuing after a multi-user failure without notifying the failed target", async () => {
        const fixture = setup("mute");
        const other_user = { ...fixture.user, id: "4000000000" } as Discord.User;
        const remaining_user = { ...fixture.user, id: "5000000000" } as Discord.User;
        fixture.apply.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Second mute failed"));
        await fixture.component.moderation_multi_issue_handler(
            fixture.command,
            [fixture.user, other_user, remaining_user],
            "1s",
            null,
            fixture.moderation,
        );
        expect(fixture.apply).toHaveBeenCalledTimes(2);
        expect(fixture.insert).toHaveBeenCalledOnce();
        expect(fixture.notify.mock.calls.map(call => call[1].id)).toEqual([fixture.user.id]);
        expect(fixture.reply_or_follow_up).toHaveBeenCalledOnce();
    });

    it.each(["note", "voice_note"] as const)("keeps %s silent across issuance paths", async type => {
        const fixture = setup(type);
        await fixture.issue();
        await fixture.component.issue_moderation_internal(
            fixture.user,
            fixture.moderator,
            1000,
            null,
            fixture.moderation,
        );
        await fixture.component.moderation_multi_issue_handler(
            fixture.command,
            [fixture.user],
            "1s",
            null,
            fixture.moderation,
        );
        expect(fixture.insert).toHaveBeenCalledTimes(3);
        expect(fixture.notify).not.toHaveBeenCalled();
    });

    it.each(["ban", "kick", "softban"] as const)("notifies before %s removes guild membership", async type => {
        const fixture = setup(type);
        await fixture.issue();
        expect(fixture.events).toEqual(["notify", "apply", "persist"]);
        expect(fixture.reply).toHaveBeenCalledOnce();
    });
});
