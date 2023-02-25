import * as Discord from "discord.js";

import { strict as assert } from "assert";
import { is_string, M } from "./utils";

// Common constants
export const MINUTE = 1000 * 60;
export const MINUTE = 1000 * 60;

export const pepereally = "<:pepereally:643881257624666112>";

export const ApplicationCommandTypeUser = 2;
export const ApplicationCommandTypeMessage = 3;

export enum colors {
    color = 0x337fd5,
    alert_color = 0xf5a53e,
    speedrun_color = 0x0fc644,
    red = 0x0,
    green = 0x0
}

// User IDs
export const zelis_id = "199943082441965577";

// Role IDs
export const moderators_role_id = "847915341954154536";
export const root_role_id = "331719468440879105";
export const pink_role_id = "888158339878490132";
export const no_off_topic = "879419994004422666";
export const everyone_role_id = "331718482485837825"; // same as TCCPP_ID

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
//    "542042995147407375"; // test server #1
export const staff_flag_log_id = "1026972603019169842";
export const bot_spam_id = "506274405500977153";
export const tutoring_id = "922603597294870609";
export const tutoring_requests_id = "915271477559984160";
export const rules_channel_id = "659868782877212723";
export const mods_channel_id = "847993258600038460";
export const introductions_channel_id = "933113495304679494";
export const memes_channel_id = "526518219549442071";
export const the_button_channel_id = "1069678919667687455";
export const skill_role_suggestion_log_id = "1079085485298815058";

// Thread-based help channels

export const thread_based_help_channel_ids = new Set([
    "976315803634925578", // cpp-help-threads
    "976315954965381170", // c-help-threads
    "873682069325217802", // today-i-learned
]);

export const thread_based_channel_ids = new Set([
    "802541516655951892", // server-suggestions
    "594212045621035030", // showcase
]);

export const thread_based_channel_ids = new Set([
    "802541516655951892", // server-suggestions
    "594212045621035030", // showcase
    "873682069325217802", // today-i-learned
]);

// General config

export const non_beginner_skill_role_ids = [
    "331876085820030978", // intermediate
    "849399021838925834", // proficient
    "331719590990184450", // advanced
    "331719591405551616", // expert
];

export const skill_role_ids = [
    "784733371275673600",  // beginner
    ...non_beginner_skill_role_ids,
];

export const authorized_admin_roles = [
    moderators_role_id,
    root_role_id
];

export const root_ids = new Set([
    "199943082441965577", // zelis
    "162964325823283200", // eisen
    "110756651694297088", // vincent
    "89441674844995584",  // styx
    // prevent Wheatley reactions being removed in server suggestions and also allow some elegant handling
    "597216680271282192", // wheatley
]);

export const root_mod_ids = [
    "199943082441965577", // zelis
    "230282234085638155", // cas
    "310536456647081985", // lumi
    "719255892813545502", // sampersand
    "162964325823283200", // eisenwave
    "89441674844995584",  // styx
    "110756651694297088", // vincent
    "138014214093668353", // dxpower
    "313597351262683138", // dot
    "413463039145410560", // karnage
    "512649489300062228", // quicknir
];

export const root_mod_ids_set = new Set(root_mod_ids);

export let root_mod_list = "jr-#6677, Eisenwave#7675, Styxs#7557, or Vin¢#1293";

export async function fetch_root_mod_list(client: Discord.Client) {
    const tags = [];
    for(const id of root_mod_ids) {
        tags.push((await client.users.fetch(id)).tag);
    }
    assert(tags.length > 3);
    root_mod_list = tags.slice(0, tags.length - 1).join(", ") + ", or " + tags[tags.length - 1];
    M.debug("root_mod_list", [root_mod_list]);
}

// Some common tools
export function is_root(user: Discord.User | Discord.PartialUser | Discord.APIUser): boolean {
    //return member.roles.cache.some(r => r.id == root_role_id);
    return root_ids.has(user.id);
}

export function is_authorized_admin(member: Discord.GuildMember | Discord.User | string): boolean {
    if(is_string(member)) {
        return root_mod_ids_set.has(member);
    } else {
        //return member.roles.cache.some(r => authorized_admin_roles.indexOf(r.id) > -1);
        return root_mod_ids_set.has(member.id);
    }
}

export const cpp_help_id = "1013107104678162544";
export const c_help_id = "1013104018739974194";

export const forum_help_channels = new Set([ cpp_help_id, c_help_id ]);

export function is_forum_help_thread(thread: Discord.ThreadChannel) {
    return thread.parentId != null && forum_help_channels.has(thread.parentId);
}

export function has_skill_roles_other_than_beginner(member: Discord.GuildMember) {
    return member.roles.cache.some(role => non_beginner_skill_role_ids.includes(role.id));
}
