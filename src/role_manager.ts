import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { MINUTE, TCCPP_ID } from "./common";
import { M } from "./utils";

// Role cleanup
// Autoremove pink roles when members are no longer boosting
// Autoremove duplicate skill roles

const pink = "888158339878490132";

let TCCPP : Discord.Guild;

var pink_role: Discord.Role;

const skill_role_ids = new Set([
	"331719591405551616",
	"331719590990184450",
	"849399021838925834",
	"331876085820030978",
	"784733371275673600"
]);

//var skill_roles: Discord.Role[] = [];
setInterval(() => {
	//M.debug("role check");
	if(TCCPP != null) {
			assert(pink_role != null);
			TCCPP!.members.fetch()
					.then(collection => {
						collection.map((m, _) => {
							// pink
							if(m.roles.cache.some(r => r.id == pink)) {
								if(m.premiumSince == null) {
									M.debug("removing pink for", m.user.tag);
									m.roles.remove(pink_role!).catch(M.error);
								}
							}
							// skill roles
							let s = m.roles.cache.filter(r => skill_role_ids.has(r.id));
							if(s.size > 1) {
								M.debug("duplicate skill roles", m.user.tag);
								M.debug(m.user.tag);
								//M.debug(s);
								s.sort((a, b) => b.rawPosition - a.rawPosition);
								M.debug(s.map(x => x.name));
								M.debug(s.map(x => x.name).slice(1));
								for(let role of s.map(x => x).slice(1)) {
									m.roles.remove(role).catch(M.error);
								}
							}
						});
					})
					.catch(M.error);
	}
}, 30 * MINUTE);

export async function setup_role_manager(client: Discord.Client) {
	try {
		TCCPP = await client.guilds.fetch(TCCPP_ID);
		pink_role = (await TCCPP.roles.fetch(pink))!;
		assert(pink_role != null);
	} catch(e) {
		M.error(e);
	}
}
