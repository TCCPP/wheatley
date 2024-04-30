import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { MINUTE } from "../common.js";
import { unwrap } from "../utils/misc.js";
import { critical_error } from "../utils/debugging-and-logging.js";
import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { set_interval } from "../utils/node.js";

// Role cleanup
// Auto-remove pink roles when members are no longer boosting
// Auto-remove duplicate skill roles

export default class RoleManager extends BotComponent {
    pink_role: Discord.Role;
    interval: NodeJS.Timeout | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_ready() {
        this.pink_role = unwrap(await this.wheatley.TCCPP.roles.fetch(this.wheatley.roles.pink.id));
        this.interval = set_interval(() => {
            this.check_users().catch(critical_error);
        }, 30 * MINUTE);
    }

    async check_users() {
        try {
            const members = await this.wheatley.TCCPP.members.fetch();
            members.map((member, _) => {
                // pink
                if (member.roles.cache.some(role => role.id == this.wheatley.roles.pink.id)) {
                    if (member.premiumSince == null) {
                        M.log("removing pink for", member.user.tag);
                        member.roles.remove(this.pink_role).catch(M.error);
                    }
                }
                // skill roles
                const skill_roles = member.roles.cache.filter(role =>
                    Object.values(this.wheatley.skill_roles).some(skill_role => role.id == skill_role.id),
                );
                if (skill_roles.size > 1) {
                    M.log("removing duplicate skill roles for", member.user.tag);
                    M.debug(member.user.tag);
                    //M.debug(s);
                    skill_roles.sort((a, b) => b.rawPosition - a.rawPosition);
                    M.debug(skill_roles.map(x => x.name));
                    M.debug(skill_roles.map(x => x.name).slice(1));
                    for (const role of skill_roles.map(x => x).slice(1)) {
                        member.roles.remove(role).catch(M.error);
                    }
                }
            });
        } catch (e) {
            critical_error(e);
        }
    }
}
