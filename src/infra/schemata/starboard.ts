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
    message_timestamp: number;
    delete_timestamp: number;
    flag_link: string | undefined;
};
