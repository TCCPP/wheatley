export type suggestion_entry = {
    suggestion: string;
    status_message: string; // dashboard snowflake
    hash: string; // to check if message is updated, currently using xxh3 (64-bit hash)
    up: number;
    down: number;
    maybe: number;
};
