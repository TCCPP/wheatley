import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { BotUtilities } from "./bot-utilities.js";
import type { named_id } from "./channel-map.js";
import { Wheatley } from "./wheatley.js";

export function define_roles<const T extends Record<string, { id: string; name?: string }>>(
    roles: T,
): { [K in keyof T & string]: T[K] & { key: K } } {
    const result = {} as { [K in keyof T & string]: T[K] & { key: K } };
    for (const [key, value] of Object.entries(roles)) {
        (result as Record<string, unknown>)[key] = { ...value, key };
    }
    return result;
}

type keyed_role_id = named_id & { key: string };

export function role_map<const T extends readonly keyed_role_id[]>(
    wheatley: Wheatley,
    ...role_ids: T
): { resolve(): void } & { [E in T[number] as E["key" | "id"]]: Discord.Role } {
    const target: Record<string, unknown> = {};
    let resolved = false;
    const resolve = () => {
        const utilities = new BotUtilities(wheatley);
        for (const role_id of role_ids) {
            const role = utilities.resolve_role(role_id);
            target[role_id.key] = role;
            target[role.id] = role;
        }
        resolved = true;
    };
    return new Proxy(target, {
        get(obj, prop) {
            if (prop === "resolve") {
                return resolve;
            }
            if (typeof prop === "string") {
                assert(resolved, `Role binding accessed before resolution (key: ${prop})`);
            }
            return Reflect.get(obj, prop);
        },
    }) as { resolve(): void } & { [E in T[number] as E["key" | "id"]]: Discord.Role };
}
