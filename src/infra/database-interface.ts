import { strict as assert } from "assert";
import { Mutex, is_string, unwrap } from "../utils.js";

import * as mongo from "mongodb";
import { no_distraction_entry } from "../components/nodistractions.js";
import { roulette_leaderboard_entry } from "../components/roulette.js";
import { buzzword_scoreboard_entry } from "../components/buzzwords.js";
import { auto_delete_threshold_notifications, starboard_entry } from "../components/starboard.js";
import { button_scoreboard_entry } from "../components/the-button.js";
import { TRACKER_START_TIME, suggestion_entry } from "../components/server-suggestion-tracker.js";
import { link_blacklist_entry } from "../private-types.js";
import { moderation_entry } from "../components/moderation/moderation-common.js";
import { wheatley_database_credentials, wheatley_database_info } from "../wheatley.js";

export class WheatleyDatabase {
    private mutex = new Mutex();
    private collections = new Map<string, mongo.Collection>();

    private constructor(
        private client: mongo.MongoClient | null,
        private db: mongo.Db | null,
    ) {}

    async close() {
        await this.client?.close();
    }

    static async create(credentials: wheatley_database_credentials) {
        const url = `mongodb://${credentials.user}:${credentials.password}@localhost:27017/?authMechanism=DEFAULT`;
        const client = new mongo.MongoClient(url);
        await client.connect();
        const db = client.db("wheatley");
        const instance = new WheatleyDatabase(client, db);
        return new Proxy(instance, {
            get: (instance, key, _proxy) => {
                if (key in instance) {
                    return (instance as any)[key];
                } else if (is_string(key)) {
                    return instance.get_collection(key);
                } else {
                    assert(false);
                }
            },
        }) as WheatleyDatabaseProxy;
    }

    get_collection(name: string) {
        if (this.collections.has(name)) {
            return unwrap(this.collections.get(name));
        } else {
            const collection = unwrap(this.db).collection(name);
            this.collections.set(name, collection);
            return collection;
        }
    }

    // TODO: typing, schema verification? Utility wrapper?
    async get_bot_singleton(): Promise<mongo.WithId<wheatley_database_info>> {
        const wheatley = this.get_collection("wheatley");
        const res = await wheatley.findOne();
        if (res == null) {
            const document = {
                id: "main",
                server_suggestions: {
                    last_scanned_timestamp: TRACKER_START_TIME,
                },
                modmail_id_counter: 0,
                the_button: {
                    button_presses: 0,
                    last_reset: Date.now(),
                    longest_time_without_reset: 0,
                },
                starboard: {
                    delete_emojis: [],
                    ignored_emojis: [],
                    negative_emojis: [],
                },
                moderation_case_number: 0,
            };
            const ires = await wheatley.insertOne(document);
            assert(ires.acknowledged);
            return {
                _id: ires.insertedId,
                ...document,
            };
        } else {
            assert(res.id === "main");
            return res as mongo.WithId<wheatley_database_info>;
        }
    }

    async update_bot_singleton(update: Partial<wheatley_database_info>) {
        const wheatley = this.get_collection("wheatley");
        await wheatley.updateOne(
            { id: "main" },
            {
                $set: update,
            },
        );
    }

    async lock() {
        await this.mutex.lock();
    }

    unlock() {
        this.mutex.unlock();
    }
}

export type WheatleyDatabaseProxy = WheatleyDatabase & {
    auto_delete_threshold_notifications: mongo.Collection<auto_delete_threshold_notifications>;
    button_scoreboard: mongo.Collection<button_scoreboard_entry>;
    buzzword_scoreboard: mongo.Collection<buzzword_scoreboard_entry>;
    link_blacklist: mongo.Collection<link_blacklist_entry>;
    nodistractions: mongo.Collection<no_distraction_entry>;
    roulette_leaderboard: mongo.Collection<roulette_leaderboard_entry>;
    server_suggestions: mongo.Collection<suggestion_entry>;
    starboard_entries: mongo.Collection<starboard_entry>;
    wheatley: mongo.Collection<wheatley_database_info>;
    moderations: mongo.Collection<moderation_entry>;
};
// & {
//    [key: string] : Promise<mongo.Collection>
//};
