import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { MINUTE } from "../common.js";
import { critical_error, unwrap, M } from "../utils.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

/**
 * Performs automated role management tasks, such as:
 * - removing @Pink roles for non-boosting members
 * - removing duplicate skill roles
 */
export default class RoleManager extends BotComponent {
    pink_role: Discord.Role;
    interval: NodeJS.Timeout | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        this.pink_role = unwrap(await this.wheatley.TCCPP.roles.fetch(this.wheatley.roles.pink.id));
        this.interval = setInterval(() => {
            this.check_users().catch(critical_error);
        }, 30 * MINUTE);
    }

    async check_users() {
        try {
            const members = await this.wheatley.TCCPP.members.fetch();
            members.map((m, _) => {
                // pink
                if (m.roles.cache.some(r => r.id == this.wheatley.roles.pink.id)) {
                    if (m.premiumSince == null) {
                        M.log("removing pink for", m.user.tag);
                        m.roles.remove(this.pink_role).catch(M.error);
                    }
                }
                // skill roles
                const s = m.roles.cache.filter(r =>
                    Object.values(this.wheatley.skill_roles).some(skill_role => r.id == skill_role.id),
                );
                if (s.size > 1) {
                    M.log("removing duplicate skill roles for", m.user.tag);
                    M.debug(m.user.tag);
                    //M.debug(s);
                    s.sort((a, b) => b.rawPosition - a.rawPosition);
                    M.debug(s.map(x => x.name));
                    M.debug(s.map(x => x.name).slice(1));
                    for (const role of s.map(x => x).slice(1)) {
                        m.roles.remove(role).catch(M.error);
                    }
                }
            });
        } catch (e) {
            critical_error(e);
        }
    }
}
