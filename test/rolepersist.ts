import { describe, expect, it, vi } from "vitest";
import * as Discord from "discord.js";
import * as mongo from "mongodb";

import Rolepersist from "../src/modules/wheatley/components/moderation/rolepersist.js";
import { moderation_entry } from "../src/modules/wheatley/components/moderation/schemata.js";

function setup(everyone_permissions: bigint = 0n, role_permissions: bigint = 0n) {
    const role_cache = new Discord.Collection<string, Discord.Role>();
    const guild = {
        id: "1000000000",
        members: { resolve: () => null },
        roles: {
            cache: role_cache,
            fetch: vi.fn((id: string) => Promise.resolve(role_cache.get(id) ?? null)),
            resolve: (role: Discord.Role | string) => role_cache.get(typeof role === "string" ? role : role.id),
        },
        channels: { cache: new Discord.Collection<string, Discord.GuildBasedChannel>() },
    } as unknown as Discord.Guild;
    const everyone = { id: guild.id, guild, permissions: new Discord.PermissionsBitField(everyone_permissions) };
    Object.assign(guild.roles, { everyone });
    const role = {
        id: "9000000000",
        name: "Moderator",
        guild,
        permissions: new Discord.PermissionsBitField(role_permissions),
    };
    role_cache.set(everyone.id, everyone as Discord.Role).set(role.id, role as Discord.Role);
    const overwrites = new Discord.Collection<string, Discord.PermissionOverwrites>();
    const channel = Object.assign(Object.create(Discord.TextChannel.prototype), {
        id: "4000000000",
        type: Discord.ChannelType.GuildText,
        guild,
        permissionOverwrites: { cache: overwrites },
    }) as Discord.TextChannel;
    guild.channels.cache.set(channel.id, channel);
    const member = {
        user: { id: "2000000000" },
        guild,
        roles: {
            cache: new Discord.Collection<string, Discord.Role>(),
            add: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        },
    };
    const stored: mongo.WithId<moderation_entry>[] = [];
    const critical_error = vi.fn();
    const component = Object.assign(Object.create(Rolepersist.prototype), {
        wheatley: { guild, try_fetch_guild_member: vi.fn().mockResolvedValue(member), critical_error },
        roles: { no_voice: { id: "8000000000" } },
        database: { moderations: { find: () => ({ toArray: () => Promise.resolve(stored) }) } },
    }) as Rolepersist;
    const entry: mongo.WithId<moderation_entry> = {
        type: "rolepersist",
        role: role.id,
        role_name: role.name,
        _id: new mongo.ObjectId(),
        case_number: 1,
        user: member.user.id,
        user_name: "Pancake",
        moderator: "3000000000",
        moderator_name: "Moderator",
        issued_at: Date.now(),
        duration: null,
        reason: null,
        active: true,
        removed: null,
        expunged: null,
        link: null,
    };
    function overwrite(id: string, allow: bigint = 0n, deny: bigint = 0n) {
        overwrites.set(id, {
            id,
            allow: new Discord.PermissionsBitField(allow),
            deny: new Discord.PermissionsBitField(deny),
        } as Discord.PermissionOverwrites);
    }
    return { component, everyone, role, role_cache, member, entry, stored, critical_error, overwrite };
}

describe("rolepersist permission ceiling", () => {
    const { Administrator, ManageRoles, ManageMessages, ViewChannel, SendMessages, UseSoundboard } =
        Discord.PermissionFlagsBits;

    it.each([0n, ViewChannel, ViewChannel | SendMessages])("allows subsets of everyone (%s)", async permissions => {
        const fixture = setup(ViewChannel | SendMessages, permissions);
        await fixture.component.apply_moderation(fixture.entry);
        expect(fixture.member.roles.add).toHaveBeenCalledExactlyOnceWith(fixture.role.id);
    });

    it.each([Administrator, ManageRoles, UseSoundboard, 1n << 60n])(
        "rejects extra guild bits (%s)",
        async permissions => {
            const fixture = setup(ViewChannel, ViewChannel | permissions);
            await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
            expect(fixture.member.roles.add).not.toHaveBeenCalled();
        },
    );

    it("does not treat everyone's administrator bit as every explicit permission", async () => {
        const fixture = setup(Administrator, ManageRoles);
        await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
    });

    it("allows matching explicit administrator bits", async () => {
        const fixture = setup(Administrator, Administrator);
        await fixture.component.apply_moderation(fixture.entry);
        expect(fixture.member.roles.add).toHaveBeenCalledOnce();
    });

    it("skips a role that no longer exists", async () => {
        const fixture = setup();
        fixture.role_cache.delete(fixture.role.id);
        await expect(fixture.component.apply_moderation(fixture.entry)).resolves.toBeUndefined();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
        expect(fixture.critical_error).toHaveBeenCalledOnce();
    });

    it("allows channel restrictions", async () => {
        const fixture = setup(ViewChannel | SendMessages);
        fixture.overwrite(fixture.role.id, 0n, SendMessages);
        await fixture.component.apply_moderation(fixture.entry);
        expect(fixture.member.roles.add).toHaveBeenCalledOnce();
    });

    it("rejects channel privileges absent from everyone's channel permissions", async () => {
        const fixture = setup(ViewChannel);
        fixture.overwrite(fixture.role.id, ManageMessages);
        await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
    });

    it("rejects private-channel viewing granted by an overwrite", async () => {
        const fixture = setup(ViewChannel);
        fixture.overwrite(fixture.everyone.id, 0n, ViewChannel);
        fixture.overwrite(fixture.role.id, ViewChannel);
        await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
    });

    it("allows channel permissions also granted to everyone in that channel", async () => {
        const fixture = setup(ViewChannel);
        fixture.overwrite(fixture.everyone.id, ManageMessages);
        fixture.overwrite(fixture.role.id, ManageMessages);
        await fixture.component.apply_moderation(fixture.entry);
        expect(fixture.member.roles.add).toHaveBeenCalledOnce();
    });

    it("disables the administrator shortcut when comparing channel permissions", async () => {
        const fixture = setup(Administrator, Administrator);
        fixture.overwrite(fixture.role.id, ManageMessages);
        await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
    });

    it("rechecks saved roles after their permissions change", async () => {
        const fixture = setup(ViewChannel);
        await fixture.component.apply_moderation(fixture.entry);
        fixture.member.roles.add.mockClear();
        fixture.role.permissions = new Discord.PermissionsBitField(ManageRoles);
        await expect(fixture.component.apply_moderation(fixture.entry)).rejects.toThrow();
        expect(fixture.member.roles.add).not.toHaveBeenCalled();
    });

    it("continues rejoin restoration after a rejected saved role", async () => {
        const fixture = setup(ViewChannel, Administrator);
        const safe_role = { ...fixture.role, id: "7000000000", permissions: new Discord.PermissionsBitField() };
        fixture.role_cache.set(safe_role.id, safe_role as Discord.Role);
        fixture.stored.push(fixture.entry, { ...fixture.entry, role: safe_role.id });
        await fixture.component.on_guild_member_add(fixture.member as unknown as Discord.GuildMember);
        expect(fixture.member.roles.add).toHaveBeenCalledExactlyOnceWith(safe_role.id);
        expect(fixture.critical_error).toHaveBeenCalledOnce();
    });

    it("allows removing a role that now exceeds the permission ceiling", async () => {
        const fixture = setup(ViewChannel, Administrator);
        await fixture.component.remove_moderation(fixture.entry);
        expect(fixture.member.roles.remove).toHaveBeenCalledExactlyOnceWith(fixture.role.id);
    });
});
