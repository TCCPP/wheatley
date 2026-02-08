import { strict as assert } from "assert";

import { BotUtilities } from "./bot-utilities.js";
import { typed_channel_id, channel_type_map, Wheatley } from "./wheatley.js";

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
