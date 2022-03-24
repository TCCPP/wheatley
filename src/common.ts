import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "./utils";

// Common constants
export const MINUTE = 1000 * 60;

export const pepereally = "<:pepereally:643881257624666112>";

export const color = 0x337fd5;
export const alert_color = 0xf5a53e;
export const speedrun_color = 0x0fc644;

// User IDs
export const zelis_id = "199943082441965577";
export const wheatley_id = "597216680271282192";

// Role IDs
export const moderators_role_id = "847915341954154536";
export const root_role_id = "331719468440879105";
export const pink_role_id = "888158339878490132";
export const no_off_topic = "879419994004422666";

// Channel/Guild IDs
export const TCCPP_ID = "331718482485837825";
export const member_log_channel_id = "875681819662622730";
export const welcome_channel_id = "778017793567490078";
export const server_suggestions_channel_id = "802541516655951892";
export const suggestion_dashboard_thread_id = "908928083879415839";
export const suggestion_action_log_thread_id = "909309608512880681";
export const message_log_channel_id = "467729928956411914";
export const action_log_channel_id =
	"845290775692443699"; // TCCPP #staff_action_log
//	"542042995147407375"; // test server #1

// General config

export const authorized_admin_roles = [
	moderators_role_id,
	root_role_id
];

export const root_ids = new Set([
	"199943082441965577", // zelis
	"272564879716646914", // aspi
	"162964325823283200", // eisen
	"110756651694297088", // vincent
	"89441674844995584",  // styx
	"597216680271282192", // wheatley <- so that Wheatly reactions aren't removed in server suggestions and also allow some elegant handling
]);

export const root_mod_ids = [
	"199943082441965577", // zelis
	"272564879716646914", // aspi
	"551519630578024468", // swyde
	"230282234085638155", // cas
	"310536456647081985", // lumi
	"719255892813545502", // sampersand
	"360166880733822976", // desgroup
	"194315619217178624", // headline
	"287714848601538561", // iunave
	"162964325823283200", // eisenwave
	"89441674844995584",  // styx
	"110756651694297088", // vincent
];

export const root_mod_ids_set = new Set(root_mod_ids);

export var root_mod_list = "jr-#6677, easyaspi314#1497, Eisenwave#7675, Styxs#7557, or Vin¢#1293";

export async function fetch_root_mod_list(client: Discord.Client) {
	let tags = [];
	for(let id of root_mod_ids) {
		tags.push((await client.users.fetch(id)).tag);
	}
	assert(tags.length > 3);
	root_mod_list = tags.slice(0, tags.length - 1).join(", ") + ", or " + tags[tags.length - 1];
	M.debug("root_mod_list", [root_mod_list]);
}

// Some common tools
export function is_root(user: Discord.User | Discord.PartialUser): boolean {
	//return member.roles.cache.some(r => r.id == root_role_id);
	return root_ids.has(user.id);
}

export function is_authorized_admin(member: Discord.GuildMember | Discord.User): boolean {
	//return member.roles.cache.some(r => authorized_admin_roles.indexOf(r.id) > -1);
	return root_mod_ids_set.has(member.id);
}
