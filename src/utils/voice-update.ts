import * as Discord from "discord.js";

import { Wheatley } from "../wheatley.js";

export type VoiceUpdateContext = {
    caller: Discord.GuildMember;
    channel: Discord.VoiceChannel | Discord.StageChannel;
    wheatley: Wheatley;
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

function is_hard_excluded(member: Discord.GuildMember, context: VoiceUpdateContext): boolean {
    if (member.id === context.caller.id) {
        return true;
    }
    return member.permissions.has(Discord.PermissionFlagsBits.MoveMembers);
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

export function select_without_role(role_id: string): VoiceUpdateSelector {
    return member => !member.roles.cache.has(role_id);
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
