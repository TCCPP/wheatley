import * as Discord from "discord.js";

import { Wheatley } from "../wheatley.js";

export type VoiceUpdateContext = {
    guild: Discord.Guild;
    caller: Discord.GuildMember;
    channel: Discord.VoiceChannel | Discord.StageChannel;
    wheatley: Wheatley;
    excludeUserIds?: string[];
};

/** Predicate that determines whether a member should be included in the refresh set. */
export type VoiceUpdateSelector = (member: Discord.GuildMember, context: VoiceUpdateContext) => boolean;

export type VoiceUpdateResult = {
    succeeded: number;
    failed: number;
    skipped: number;
    total: number;
    afk_missing: boolean;
};

const MOVE_MEMBERS = Discord.PermissionFlagsBits.MoveMembers;

function is_hard_excluded(member: Discord.GuildMember, context: VoiceUpdateContext): boolean {
    if (member.id === context.caller.id) {
        return true;
    }
    if (member.permissions.has(MOVE_MEMBERS)) {
        return true;
    }
    if (context.excludeUserIds?.includes(member.id)) {
        return true;
    }
    return false;
}

export const select_everyone: VoiceUpdateSelector = () => true;

export function exclude_bots(selector: VoiceUpdateSelector): VoiceUpdateSelector {
    return (member, context) => {
        if (member.user.bot) {
            return false;
        }
        return selector(member, context);
    };
}

export function require_roles(roleIds: string[], selector: VoiceUpdateSelector): VoiceUpdateSelector {
    return (member, context) => {
        if (!selector(member, context)) {
            return false;
        }
        return roleIds.some(id => member.roles.cache.has(id));
    };
}

export function forbid_roles(roleIds: string[], selector: VoiceUpdateSelector): VoiceUpdateSelector {
    return (member, context) => {
        if (!selector(member, context)) {
            return false;
        }
        return !roleIds.some(id => member.roles.cache.has(id));
    };
}

export function require_permissions(
    permissions: Discord.PermissionResolvable,
    selector: VoiceUpdateSelector,
): VoiceUpdateSelector {
    const bits = BigInt(Discord.PermissionsBitField.resolve(permissions));
    return (member, context) => {
        if (!selector(member, context)) {
            return false;
        }
        return member.permissions.has(bits);
    };
}

export function forbid_permissions(
    permissions: Discord.PermissionResolvable,
    selector: VoiceUpdateSelector,
): VoiceUpdateSelector {
    const bits = BigInt(Discord.PermissionsBitField.resolve(permissions));
    return (member, context) => {
        if (!selector(member, context)) {
            return false;
        }
        return !member.permissions.has(bits);
    };
}

export function include_users(userIds: string[], selector: VoiceUpdateSelector): VoiceUpdateSelector {
    const set = new Set(userIds);
    return (member, context) => {
        if (!selector(member, context)) {
            return false;
        }
        return set.has(member.id);
    };
}

export function or_include_users(userIds: string[], selector: VoiceUpdateSelector): VoiceUpdateSelector {
    const set = new Set(userIds);
    return (member, context) => selector(member, context) || set.has(member.id);
}

export function select_without_role(roleId: string, base: VoiceUpdateSelector = select_everyone): VoiceUpdateSelector {
    return forbid_roles([roleId], base);
}

export async function perform_voice_update(
    context: VoiceUpdateContext,
    selector: VoiceUpdateSelector,
): Promise<VoiceUpdateResult> {
    if (!context.wheatley.guild.afkChannel) {
        return { succeeded: 0, failed: 0, skipped: 0, total: 0, afk_missing: true };
    }

    const members = [...context.channel.members.values()].filter(m => {
        if (is_hard_excluded(m, context)) {
            return false;
        }
        return selector(m, context);
    });

    const results = await Promise.allSettled(members.map(m => context.wheatley.force_voice_permissions_update(m)));

    const succeeded = results.filter(r => r.status === "fulfilled" && r.value).length;
    const skipped = results.filter(r => r.status === "fulfilled" && !r.value).length;
    const failed = results.filter(r => r.status === "rejected").length;

    return { succeeded, failed, skipped, total: members.length, afk_missing: false };
}
