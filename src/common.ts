import * as Discord from "discord.js";

// Common constants
export const MINUTE = 1000 * 60;

// User IDs
export const zelis = "199943082441965577";
export const illuminator = "391270706186420224";

// Role IDs
export const moderators_role_id = "847915341954154536";
export const root_role_id = "331719468440879105";

// Channel/Guild IDs
export const TCCPP_ID = "331718482485837825";
export const member_log_channel_id = "875681819662622730";
export const welcome_channel_id = "778017793567490078";
export const server_suggestions_channel_id = "802541516655951892";


// Component config
export const action_log_channel_id =
	"845290775692443699"; // TCCPP #staff_action_log
//	"542042995147407375"; // test server #1

export const tracked_mentions = [
	"540314034894012428", // admin role on test server
	root_role_id,
	moderators_role_id,
	"892864085006360626", // red dragon
	"859474976242270249" // wheatly
];

export const authorized_admin_roles = [
	//moderators_role_id,
	root_role_id
];

export const obnoxious_autoreact_ids = [
	"841482328693669900" // "eisie"
];

export const obnoxious_autoreact_names = [
	"eisie"
];

export const obnoxious_autoreact_immunity = new Set([
	zelis,
	"551519630578024468" // Swyde
]);

export const root_only_reacts = new Set(["🟢", "🔴", "🟡", "🟩", "🟥", "🟨", "🚫"]);

export const pepereally = "<:pepereally:643881257624666112>";

export const color = 0x337fd5;
export const alert_color = 0xf5a53e;
export const speedrun_color = 0x0fc644;

export const notify_user_on_purge = true;

export function is_root(member: Discord.GuildMember): boolean {
	return member.roles.cache.some(r => r.id == root_role_id);
}

export function is_authorized_admin(member: Discord.GuildMember): boolean {
	return member.roles.cache.some(r => authorized_admin_roles.indexOf(r.id) > -1);
}
