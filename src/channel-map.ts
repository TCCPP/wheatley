import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { BotUtilities } from "./bot-utilities.js";
import { Wheatley } from "./wheatley.js";

export type named_id = {
    // channel id used in production
    id: string;

    // fallback channel name (for development only)
    name?: string;
};

export type channel_type = "text" | "forum" | "voice" | "thread";

export type typed_channel_id = named_id & { type: channel_type };

export type channel_type_map = {
    text: Discord.TextChannel;
    forum: Discord.ForumChannel;
    voice: Discord.VoiceChannel;
    thread: Discord.ThreadChannel;
};

export function define_channels<const T extends Record<string, { id: string; name?: string; type: channel_type }>>(
    channels: T,
): { [K in keyof T & string]: T[K] & { key: K } } {
    const result = {} as { [K in keyof T & string]: T[K] & { key: K } };
    for (const [key, value] of Object.entries(channels)) {
        (result as Record<string, unknown>)[key] = { ...value, key };
    }
    return result;
}

type keyed_channel_id = typed_channel_id & { key: string };

export function channel_map<const T extends readonly keyed_channel_id[]>(
    wheatley: Wheatley,
    ...channel_ids: T
): { resolve(): Promise<void> } & { [E in T[number] as E["key"]]: channel_type_map[E["type"]] } {
    const target: Record<string, unknown> = {};
    let resolved = false;
    const resolve = async () => {
        const utilities = new BotUtilities(wheatley);
        for (const channel_id of channel_ids) {
            target[channel_id.key] = await utilities.resolve_channel(channel_id);
        }
        resolved = true;
    };
    return new Proxy(target, {
        get(obj, prop) {
            if (prop === "resolve") {
                return resolve;
            }
            if (typeof prop === "string") {
                assert(resolved, `Channel binding accessed before resolution (key: ${prop})`);
            }
            return Reflect.get(obj, prop);
        },
    }) as { resolve(): Promise<void> } & { [E in T[number] as E["key"]]: channel_type_map[E["type"]] };
}
