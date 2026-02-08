import { define_channels } from "../../channel-map.js";

export const wheatley_channels = define_channels({
    // staff
    staff_flag_log: { id: "1026972603019169842", name: "🚩-flag-log", type: "text" },
    staff_delet_log: { id: "1462879414864838869", name: "🗑️-delet-log", type: "text" },
    staff_experimental_log: { id: "1207899185790197760", name: "😱-experimental-log", type: "text" },
    staff_action_log: { id: "845290775692443699", name: "🔨-action-log", type: "text" },
    public_action_log: { id: "1341611685223596103", name: "moderation-log", type: "text" },
    staff_clock_log: { id: "1220882759862452284", name: "👀-clock-log", type: "forum" },
    welcome: { id: "778017793567490078", name: "📈-join-boost-log", type: "text" },
    staff_member_log: { id: "875681819662622730", name: "👥-member-log", type: "text" },
    staff_message_log: { id: "467729928956411914", name: "💬-message-log", type: "text" },
    staff_only: { id: "342153262260289537", name: "staff-only", type: "text" },
    mods: { id: "847993258600038460", name: "mods-🚲", type: "text" },
    voice_hotline: { id: "1379456835634987098", name: "voice-hotline", type: "voice" },

    // meta/infrastructure
    rules: { id: "659868782877212723", name: "rules", type: "text" },
    announcements: { id: "331881381477089282", name: "announcements", type: "text" },
    bot_spam: { id: "506274405500977153", name: "bot-spam", type: "text" },
    pin_archive: { id: "1284234644396572714", name: "pin-archive", type: "text" },
    red_telephone_alerts: { id: "1140096352278290512", name: "red-telephone-alerts", type: "text" },
    log: { id: "1260777903700971581", name: "🤖-wheatley-log", type: "text" },

    // language/help channels
    cpp_help: { id: "1013107104678162544", name: "cpp-help", type: "forum" },
    c_help: { id: "1013104018739974194", name: "c-help", type: "forum" },
    cpp_help_text: { id: "331718580070645760", name: "cpp-help-text", type: "text" },
    c_help_text: { id: "331718539738087426", name: "c-help-text", type: "text" },
    c_cpp_discussion: { id: "851121440425639956", name: "c-cpp-discussion", type: "text" },
    general_discussion: { id: "855220264149057556", name: "general-technical", type: "text" },
    tooling: { id: "331913460080181258", name: "tooling", type: "text" },
    algorithms_and_compsci: { id: "857668280012242944", name: "algorithms-and-compsci", type: "text" },
});
