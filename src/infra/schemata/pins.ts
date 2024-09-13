// we store all pins for the server, with a flag indicating if currently in the pin list
export type pin_entry = {
    channel: string;
    message: string;
    current_pin: boolean;
};

// stored for edit/update reasons
export type pin_archive_entry = {
    archive_message: string;
    source_channel: string;
    source_message: string;
};
