import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { is_string } from "../utils/strings.js";
import { Mutex } from "../utils/containers.js";

import * as mongo from "mongodb";
import { link_blacklist_entry, watchlist_entry } from "../private-types.js";
import { wheatley_database_credentials, wheatley_database_info } from "../wheatley.js";

import { buzzword_scoreboard_entry } from "./schemata/buzzwords.js";
import { moderation_entry } from "./schemata/moderation-common.js";
import { no_distraction_entry } from "./schemata/nodistractions.js";
import { roulette_leaderboard_entry } from "./schemata/roulette.js";
import { suggestion_entry } from "./schemata/server-suggestion-tracker.js";
import { skill_suggestion_entry } from "./schemata/skill-role-suggestion.js";
import { auto_delete_threshold_notifications, starboard_entry } from "./schemata/starboard.js";
import { button_scoreboard_entry } from "./schemata/the-button.js";

export class WheatleyDatabase {
    private mutex = new Mutex();
    private collections = new Map<string, mongo.Collection>();

    private constructor(
        private get_initial_wheatley_info: () => wheatley_database_info,
        private client: mongo.MongoClient | null,
        private db: mongo.Db | null,
    ) {}

    async close() {
        await this.client?.close();
    }

    static async create(
        get_initial_wheatley_info: () => wheatley_database_info,
        credentials: wheatley_database_credentials,
    ) {
        const [user, password] = [credentials.user, credentials.password].map(encodeURIComponent);
        const url = `mongodb://${user}:${password}@localhost:27017/?authMechanism=DEFAULT&authSource=wheatley`;
        const client = new mongo.MongoClient(url);
        await client.connect();
        const db = client.db("wheatley");
        const instance = new WheatleyDatabase(get_initial_wheatley_info, client, db);
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

    async get_bot_singleton(): Promise<mongo.WithId<wheatley_database_info>> {
        const wheatley = this.get_collection("wheatley");
        const res = await wheatley.findOne();
        if (res == null) {
            const document = this.get_initial_wheatley_info();
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
    watchlist: mongo.Collection<watchlist_entry>;
    nodistractions: mongo.Collection<no_distraction_entry>;
    roulette_leaderboard: mongo.Collection<roulette_leaderboard_entry>;
    server_suggestions: mongo.Collection<suggestion_entry>;
    starboard_entries: mongo.Collection<starboard_entry>;
    wheatley: mongo.Collection<wheatley_database_info>;
    moderations: mongo.Collection<moderation_entry>;
    skill_role_suggestions: mongo.Collection<skill_suggestion_entry>;
};
// & {
//    [key: string] : Promise<mongo.Collection>
//};
