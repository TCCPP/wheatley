import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { bot_spam_id, MINUTE, TCCPP_ID } from "../common";
import { critical_error, denullify, M, textchannelify } from "../utils";

let TCCPP: Discord.Guild;
let bot_spam: Discord.TextBasedChannel;

function is_valid_codepoint(str: string, i: number) {
    const code_point = str.codePointAt(i);
    return code_point == undefined || code_point < 128;
}

// based on https://coolaj86.com/articles/how-to-count-unicode-characters-in-javascript/
function has_three_continuous_valid_asciis(str: string) {
    let index: number;
    let consecutive_count = 0;
    for(index = 0; index < str.length;) {
        let point = str.codePointAt(index);
        assert(point !== undefined);
        if(point > 32 && point < 127) {
            consecutive_count++;
            if(consecutive_count >= 3) {
                return true;
            }
        } else {
            consecutive_count = 0;
        }
        let width = 0;
        while(point) {
            width += 1;
            point = point >> 8;
        }
        index += Math.round(width/2);
    }
    return false;
}

function is_valid_name(name: string) {
    return is_valid_codepoint(name, 0) || has_three_continuous_valid_asciis(name);
}

async function check_member(member: Discord.GuildMember) {
    if(member.nickname && !is_valid_name(member.nickname)) {
        if(is_valid_name(member.user.username)) {
            // Invalid nickname, valid username: Just remove nickname
            M.debug("Username management: Removing nickname", [member.id, member.user.tag, member.nickname]);
            await member.setNickname(null);
        } else {
            // Invalid nickname and invalid username: Monke
            M.debug("Username management: Changing nickname", [member.id, member.user.tag, member.displayName]);
            await member.setNickname(`Monke ${member.user.discriminator}`);
        }
    } else if(!is_valid_name(member.displayName)) {
        // No nickname and invalid username: Monke
        M.debug("Username management: Changing nickname", [member.id, member.user.tag, member.displayName]);
        await member.setNickname(`Monke ${member.user.discriminator}`);
    } else {
        return;
    }
    // The only paths that fallthrough here change the username
    bot_spam.send({
        content: `<@${member.id}> Your nickname has been automatically changed to something with less unicode in it`
    });
}

async function cleanup() {
    try {
        const members = await TCCPP.members.fetch();
        for(const [_, member] of members) {
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
            await check_member(member);
        }
        M.log("Finished username manager cleanup");
    } catch(e) {
        critical_error(e);
    }
}

async function on_guild_member_update(old_member: Discord.GuildMember | Discord.PartialGuildMember,
                                      new_member: Discord.GuildMember) {
    if(old_member.nickname !== new_member.nickname) {
        await check_member(new_member);
    }
}

async function on_guild_member_join(member: Discord.GuildMember) {
    await check_member(member);
}

export function setup_username_manager(client: Discord.Client) {
    M.debug("setup_username_manager");
    client.on("ready", async () => {
        try {
            TCCPP = await client.guilds.fetch(TCCPP_ID);
            bot_spam = textchannelify(denullify(await TCCPP.channels.fetch(bot_spam_id)));
            client.on("guildMemberUpdate", on_guild_member_update);
            client.on("guildMemberAdd", on_guild_member_join);
            await cleanup();
            //setInterval(cleanup, 60 * MINUTE);
        } catch(e) {
            critical_error(e);
        }
    });
}
