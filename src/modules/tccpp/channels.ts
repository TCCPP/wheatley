import * as Discord from "discord.js";

import { define_channels } from "../../channel-map.js";
import { wheatley_channels } from "../wheatley/channels.js";

export const tccpp_channels = define_channels({
    // meta
    server_suggestions: { id: "802541516655951892", name: "server-suggestions", type: "text" },
    skill_role_suggestions: { id: "1211089633547526204", name: "skill-role-suggestions", type: "forum" },
    skill_roles_meta: { id: "1182536717056618557", name: "skill-roles-meta", type: "text" },
    news: { id: "1269506410530738267", name: "news", type: "text" },
    old_resources: { id: "1124619767542718524", name: "old-resources", type: "forum" },
    resources: { id: "1361574878561570926", name: "resources", type: "text" },
    partners: { id: "904790565000986745", name: "partners", type: "text" },
    the_button: { id: "1069678919667687455", name: "the-button", type: "text" },
    articles: { id: "1130174377539940475", name: "archived-articles", type: "text" },

    // content
    starboard: { id: "800509841424252968", name: "starboard", type: "text" },
    memes: { id: "526518219549442071", name: "memes", type: "text" },
    food: { id: "1288515484513468436", name: "food", type: "text" },
    serious_off_topic: { id: "921113903574958080", name: "serious-off-topic", type: "text" },
    room_of_requirement: { id: "1082800064113672192", name: "pets", type: "text" },
    boosters_only: { id: "792183875241639977", name: "🩷pink🩷", type: "text" },
    code_review: { id: "1078717238678409369", name: "code-review", type: "forum" },
    showcase: { id: "1014328785685979136", name: "showcase", type: "forum" },

    // community
    introductions: { id: "933113495304679494", name: "introductions", type: "text" },
    cursed_code: { id: "855220292736516128", name: "cursed-code", type: "text" },
    suggestion_dashboard: { id: "908928083879415839", name: "Suggestions Dashboard", type: "thread" },
    suggestion_action_log: { id: "909309608512880681", name: "Suggestion Action Log", type: "thread" },
    today_i_learned: { id: "873682069325217802", name: "did-you-know", type: "text" },
    goals2024: { id: "1189255286364569640", name: "2024-goals", type: "text" },
    goals2025: { id: "1323734788707848253", name: "2025-goals", type: "text" },
    goals2026: { id: "1454237273712492615", name: "archived-2026-goals", type: "text" },
    days_since_last_incident: { id: "1195920462958575676", name: "days-since-last-incident", type: "text" },
    literally_1984: { id: "1097993854214488154", name: "literally-1984", type: "text" },
    lore: { id: "890067781628866620", name: "lore", type: "text" },
    bot_dev_internal: { id: "1166517065763536977", name: "wheatley-dev-internal", type: "text" },
    skill_role_log: { id: "1315023714206617610", name: "skill-role-log", type: "text" },
    polls: { id: "1319336135213846568", name: "polls", type: "news" },
    wiki_dev: { id: "1350899338229846127", name: "wiki-dev", type: "text" },

    // voice
    chill: { id: "1358502332941467879", name: "Chill", type: "voice" },
    work_3: { id: "1358502770575147230", name: "Work 3", type: "voice" },
    work_4: { id: "1367735453112864838", name: "Work 4", type: "voice" },
    afk: { id: "331732845523369985", name: "AFK", type: "voice" },
    deans_office: { id: "1379612678649155755", name: "Dean's Office", type: "voice" },
});

export function is_forum_help_channel(id: string) {
    return [wheatley_channels.cpp_help, wheatley_channels.c_help].some(channel_info => channel_info.id === id);
}

export function is_forum_help_thread(thread: Discord.ThreadChannel) {
    return thread.parentId != null && is_forum_help_channel(thread.parentId);
}
