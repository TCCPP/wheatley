export type starboard_entry = {
    message: string;
    starboard_entry: string;
    deleted?: boolean;
};

export type auto_delete_threshold_notifications = {
    message: string;
};

export type auto_delete_entry = {
    user: string;
    message_id: string;
    flag_link: string | undefined;
    timestamp: number;
};
