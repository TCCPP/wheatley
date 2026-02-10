import { strict as assert } from "assert";
import { unwrap } from "../utils/misc.js";
import { is_string } from "../utils/strings.js";
import { Mutex } from "../utils/containers.js";

import * as mongo from "mongodb";
import { Wheatley, wheatley_database_credentials } from "../wheatley.js";

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

    async with_transaction<T>(fn: (session: mongo.ClientSession) => Promise<T>): Promise<T> {
        const session = this.client.startSession();
        try {
            return await session.withTransaction(fn);
        } finally {
            await session.endSession();
        }
    }
}

function generate_index_name(spec: mongo.IndexSpecification): string {
    if (typeof spec === "string") {
        return `wheatley_${spec}_1`;
    }
    if (Array.isArray(spec)) {
        return "wheatley_" + spec.map(item => (Array.isArray(item) ? `${item[0]}_${item[1]}` : item)).join("_");
    }
    return (
        "wheatley_" +
        Object.entries(spec)
            .map(([k, v]) => `${k}_${v}`)
            .join("_")
    );
}

export async function ensure_index<T extends mongo.Document>(
    wheatley: Wheatley,
    collection: mongo.Collection<T>,
    index_spec: mongo.IndexSpecification,
    options?: mongo.CreateIndexesOptions,
) {
    const index_name = generate_index_name(index_spec);
    const full_options = { ...options, name: index_name };
    try {
        return await collection.createIndex(index_spec, full_options);
    } catch (e) {
        if (e instanceof mongo.MongoServerError && e.code === 85) {
            const indexes = await collection.indexes();
            const conflicting = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify(index_spec));
            if (conflicting) {
                // && !conflicting.name?.startsWith("wheatley_")
                // Old auto-generated index, safe to drop
                await collection.dropIndex(conflicting.name!);
                await collection.createIndex(index_spec, full_options);
            } else {
                wheatley.critical_error(e);
            }
        } else {
            wheatley.critical_error(e);
        }
    }
}
