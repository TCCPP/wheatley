import * as Discord from "discord.js";

// indices: author.id, channel, id, timestamp
export type message_database_entry = {
    author: {
        display_name: string;
        iconURL: string;
        username: string;
        id: string;
    };
    guild: string;
    channel: string;
    id: string;
    timestamp: number;
    edits: { content: string; embeds: Discord.APIEmbed[]; attachments: Discord.Attachment[]; timestamp: number }[];
    deleted?: number;
};

// indices: channel
export type message_database_status_entry = {
    channel: string;
    name: string;
    public: boolean;
    // for messages: start at last seen message timestamp and work forwards
    last_seen_timestamp: number;
    // for threads: start at most recent time and work backwards until seeing already-seen threads
    last_seen_thread_timestamp: number;
};

// indices: thread, thread_parent
export type message_database_thread_status_entry = {
    thread: string;
    name: string;
    public: boolean;
    thread_parent: string | null;
    last_seen_timestamp: number;
};
