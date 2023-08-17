import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, critical_error } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MINUTE } from "../common.js";

import anyAscii from "any-ascii";

function is_valid_codepoint(c: string) {
    return (c.codePointAt(0) ?? 0) < 128;
}

function is_all_ascii(str: string) {
    return [...str].every(is_valid_codepoint);
}

// based on https://coolaj86.com/articles/how-to-count-unicode-characters-in-javascript/
function has_three_continuous_valid_asciis(str: string) {
    let index: number;
    let consecutive_count = 0;
    for (index = 0; index < str.length; ) {
        let point = str.codePointAt(index);
        assert(point !== undefined);
        if (point > 32 && point < 127) {
            consecutive_count++;
            if (consecutive_count >= 3) {
                return true;
            }
        } else {
            consecutive_count = 0;
        }
        let width = 0;
        while (point) {
            width += 1;
            point = point >> 8;
        }
        index += Math.round(width / 2);
    }
    return false;
}

function is_valid_name(name: string) {
    return is_all_ascii(name) || is_valid_codepoint(name[0]) || has_three_continuous_valid_asciis(name);
}

/**
 * Manages users with invalid names, such as unicode spam.
 */
export default class UsernameManager extends BotComponent {
    interval: NodeJS.Timeout | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override destroy() {
        super.destroy();
        if (this.interval) {
            clearInterval(this.interval);
        }
    }

    override async on_ready() {
        await this.cleanup();
        // Every hour give it a scan
        this.interval = setInterval(() => {
            this.cleanup().catch(critical_error);
        }, 60 * MINUTE);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        await this.check_member(member);
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember,
    ) {
        if (old_member.nickname !== new_member.nickname) {
            await this.check_member(new_member);
        }
    }

    async check_member(member: Discord.GuildMember) {
        //M.debug(
        //    member.displayName, // server nickname, user display name
        //    member.user.displayName, // user display name, username
        //    member.user.globalName, // user display name
        //    member.user.username,
        //    member.user.tag, // user display name, possibly with #disc
        //    member.user.discriminator,
        //);
        if (!is_valid_name(member.displayName.trim())) {
            // Invalid nickname, valid username: Just remove nickname
            const candidate_1 = anyAscii(member.displayName).trim().substring(0, 32);
            const candidate_2 = anyAscii(member.user.username).trim().substring(0, 32);
            const new_name = candidate_1 || candidate_2 || "Monke";
            M.log(
                "Username management: Changing display name",
                member.id,
                [member.user.tag, member.displayName],
                "to:",
                new_name,
            );
            await member.setNickname(new_name);
        } else {
            return;
        }
    }

    async cleanup() {
        const members = await this.wheatley.TCCPP.members.fetch();
        for (const [_, member] of members) {
            // undo my first go
            //if(member.displayName.startsWith("Monke ")) {
            //    const old = member.displayName.slice("Monke ".length);
            //    if(!(is_valid_codepoint(old, 0) && is_valid_codepoint(old, 1) && is_valid_codepoint(old, 2))) {
            //        // we changed it
            //        await member.setNickname(old);
            //    }
            //    //if(member.displayName.match(/Monke \d{4}/gi)) {
            //    //    M.debug("Revert?", [member.displayName, member.user.username]);
            //    //    await member.setNickname(null);
            //    //}
            //}
            // end
            await this.check_member(member);
        }
        M.log("Finished username manager cleanup");
    }
}
