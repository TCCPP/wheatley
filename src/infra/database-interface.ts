import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { is_string } from "../utils/strings.js";
import { Mutex } from "../utils/containers.js";

import * as mongo from "mongodb";
import { wheatley_database_credentials } from "../wheatley.js";

export class WheatleyDatabase {
    private readonly mutex = new Mutex();
    private readonly collections = new Map<string, mongo.Collection>();

    private constructor(
        private readonly client: mongo.MongoClient,
        private readonly db: mongo.Db,
    ) {}

    async close() {
        await this.client.close();
    }

    static async create(credentials: wheatley_database_credentials) {
        const [user, password] = [credentials.user, credentials.password].map(encodeURIComponent);
        const host = credentials.host ?? "localhost";
        const port = credentials.port ?? 27017;
        const url = `mongodb://${user}:${password}@${host}:${port}/?authMechanism=DEFAULT&authSource=wheatley`;
        const client = new mongo.MongoClient(url, { retryWrites: true });
        await client.connect();
        const db = client.db("wheatley");
        return new WheatleyDatabase(client, db);
    }

    async list_collections() {
        const res = new Map<string, mongo.CollectionInfo>();
        for await (const info of this.db.listCollections({}, { nameOnly: false })) {
            res.set(info.name, info);
        }
        return res;
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

    create_proxy<T extends { [key: string]: mongo.Document }>() {
        return new Proxy(this, {
            get: (instance, key, _proxy) => {
                if (key in instance) {
                    return (instance as any)[key];
                } else if (is_string(key)) {
                    return instance.get_collection(key);
                } else {
                    assert(false);
                }
            },
        }) as unknown as { [k in keyof T]: mongo.Collection<T[k]> };
    }

    async lock() {
        await this.mutex.lock();
    }

    unlock() {
        this.mutex.unlock();
    }
}
