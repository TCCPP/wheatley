export type wheatley_database_info = {
    id: string;
    server_suggestions: {
        last_scanned_timestamp: number;
    };
    modmail_id_counter: number;
    the_button: {
        button_presses: number;
        last_reset: number;
        longest_time_without_reset: number;
    };
    starboard: {
        delete_emojis: string[];
        ignored_emojis: string[];
        negative_emojis: string[];
        repost_emojis: string[];
    };
    moderation_case_number: number;
    watch_number: number;
};
