import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { MINUTE } from "../common.js";


export class UsernameManager extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        await this.cleanup();
        // Every hour give it a scan
        setInterval(async () => {
            await this.cleanup();
        }, 60 * MINUTE);
    }

    override async on_guild_member_add(member: Discord.GuildMember) {
        await this.check_member(member);
    }

    override async on_guild_member_update(
        old_member: Discord.GuildMember | Discord.PartialGuildMember,
        new_member: Discord.GuildMember
    ) {
        if(old_member.nickname !== new_member.nickname) {
            await this.check_member(new_member);
        }
    }

    async check_member(member: Discord.GuildMember) {
        //
    }

    async cleanup() {
        const members = await this.wheatley.TCCPP.members.fetch();
        for(const [ _, member ] of members) {
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
