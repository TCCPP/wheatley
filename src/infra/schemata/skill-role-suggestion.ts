export type skill_level = "beginner" | "intermediate" | "proficient" | "advanced" | "expert";

export type skill_suggestion_entry = {
    user_id: string;
    suggested_by: string;
    time: number;
    level: skill_level;
};

export type skill_suggestion_thread_entry = {
    user_id: string;
    channel_id: string;
    thread_opened: number;
    thread_closed: number | null;
};
