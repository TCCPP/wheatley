import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { MINUTE, pink_role_id, skill_role_ids, TCCPP_ID } from "../common";
import { critical_error, denullify, M } from "../utils";
import { BotComponent } from "../bot_component";
import { Wheatley } from "../wheatley";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

export class RoleManager extends BotComponent {
    pink_role: Discord.Role;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        this.pink_role = denullify(await this.wheatley.TCCPP.roles.fetch(pink_role_id));
        setInterval(this.check_users, 30 * MINUTE);
    }

    async check_users() {
        try {
            const members = await this.wheatley.TCCPP.members.fetch();
            members.map((m, _) => {
                // pink
                if(m.roles.cache.some(r => r.id == pink_role_id)) {
                    if(m.premiumSince == null) {
                        M.log("removing pink for", m.user.tag);
                        m.roles.remove(this.pink_role!).catch(M.error);
                    }
                }
                // skill roles
                const s = m.roles.cache.filter(r => skill_role_ids.has(r.id));
                if(s.size > 1) {
                    M.log("removing duplicate skill roles for", m.user.tag);
                    M.debug(m.user.tag);
                    //M.debug(s);
                    s.sort((a, b) => b.rawPosition - a.rawPosition);
                    M.debug(s.map(x => x.name));
                    M.debug(s.map(x => x.name).slice(1));
                    for(const role of s.map(x => x).slice(1)) {
                        m.roles.remove(role).catch(M.error);
                    }
                }
            });
        } catch(e) {
            critical_error(e);
        }
    }
}
