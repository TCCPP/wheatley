import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { MINUTE, pink_role_id, skill_role_ids, TCCPP_ID } from "../common";
import { critical_error, M } from "../utility/utils";

// Role cleanup
// Autoremove pink roles when members are no longer boosting
// Autoremove duplicate skill roles

let TCCPP : Discord.Guild;
let pink_role: Discord.Role;

async function interval() {
    try {
        const members = await TCCPP.members.fetch();
        members.map((m, _) => {
            // pink
            if(m.roles.cache.some(r => r.id == pink_role_id)) {
                if(m.premiumSince == null) {
                    M.debug("removing pink for", m.user.tag);
                    m.roles.remove(pink_role!).catch(M.error);
                }
            }
            // skill roles
            const s = m.roles.cache.filter(r => skill_role_ids.has(r.id));
            if(s.size > 1) {
                M.debug("duplicate skill roles", m.user.tag);
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

export function setup_role_manager(client: Discord.Client) {
    M.debug("setup_role_manager");
    client.on("ready", async () => {
        try {
            TCCPP = await client.guilds.fetch(TCCPP_ID);
            const role = await TCCPP.roles.fetch(pink_role_id);
            assert(role != null);
            pink_role = role;
            M.debug("setup_role_manager: got TCCPP and pink_role");
            setInterval(interval, 30 * MINUTE);
        } catch(e) {
            critical_error(e);
        }
    });
}
