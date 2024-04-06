export type moderation_type = "mute" | "warn" | "ban" | "kick" | "rolepersist" | "timeout" | "softban";

export type moderation_edit_info = {
    moderator: string;
    moderator_name: string;
    timestamp: number;
    reason: string | null;
};

export type basic_moderation =
    | {
          type: Exclude<moderation_type, "rolepersist">;
      }
    | {
          type: "rolepersist";
          role: string; // snowflake
          role_name: string;
      };

export type basic_moderation_with_user = basic_moderation & { user: string };

// TODO: Rename to moderation base?

// Indexes: ID, type, case number, user, moderator, active
export type moderation_entry = basic_moderation & {
    case_number: number;
    user: string; // snowflake
    user_name: string;
    moderator: string; // snowflake
    moderator_name: string;
    reason: string | null;
    issued_at: number; // milliseconds since epoch
    duration: number | null; // milliseconds
    active: boolean; // active and can be deactivated at some point
    removed: moderation_edit_info | null;
    expunged: moderation_edit_info | null;
    link: string | null;
};
