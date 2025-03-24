import { MongoClient } from "mongodb";
import * as fs from "fs";

// nodistractions
// suggestion_tracker
// link_blacklist
// roulette_leaderboard
// modmail_id_counter
// the_button
// buzzword-scoreboard
// starboard

// ts-node-esm scripts/dbmigrate.ts

async function main() {
    let client: MongoClient | null = null;
    try {
        const config = JSON.parse(await fs.promises.readFile("config.json", "utf-8"));
        const url = `mongodb://${config.mongouser}:${config.mongopassword}@localhost:27017/?authMechanism=DEFAULT`;
        client = new MongoClient(url);

        const botjson = JSON.parse(await fs.promises.readFile("bot.json", "utf-8"));

        const dbName = "wheatley";
        await client.connect();
        const db = client.db(dbName);

        const collections = await db.collections();
        for (const collection of collections) {
            if (collection.collectionName !== "test") {
                await collection.drop();
            }
        }

        const wheatley = db.collection("wheatley");
        const res = await wheatley.findOne();
        if (res == null) {
            await wheatley.createIndex({ id: 1 }, { unique: true });
            await wheatley.insertOne({
                id: "main",
            });
        }

        // nodistractions
        const nodistractions = db.collection("nodistractions");
        for (const [k, v] of Object.entries(botjson.nodistractions)) {
            await nodistractions.insertOne({
                user: k,
                ...(v as any),
            });
        }
        await nodistractions.createIndex({ user: 1 }, { unique: true });
        // suggestion_tracker
        await wheatley.updateOne(
            { id: "main" },
            {
                $set: {
                    "server_suggestions.last_scanned_timestamp": botjson.suggestion_tracker.last_scanned_timestamp,
                },
            },
        );
        const server_suggestions = db.collection("server_suggestions");
        for (const [k, v] of Object.entries(botjson.suggestion_tracker.suggestions)) {
            await server_suggestions.insertOne({
                suggestion: k,
                ...(v as any),
            });
        }
        await server_suggestions.createIndex({ suggestion: 1 }, { unique: true });
        await server_suggestions.createIndex({ status_message: 1 }, { unique: true });
        // link_blacklist
        const link_blacklist = db.collection("link_blacklist");
        for (const v of botjson.link_blacklist) {
            await link_blacklist.insertOne({
                url: v,
            });
        }
        await link_blacklist.createIndex({ url: 1 }, { unique: true });
        // roulette_leaderboard
        const roulette_leaderboard = db.collection("roulette_leaderboard");
        for (const [k, v] of Object.entries(botjson.roulette_leaderboard)) {
            await roulette_leaderboard.insertOne({
                user: k,
                highscore: v,
            });
        }
        await roulette_leaderboard.createIndex({ user: 1 }, { unique: true });
        await roulette_leaderboard.createIndex({ highscore: -1 });
        // modmail_id_counter
        await wheatley.updateOne(
            { id: "main" },
            {
                $set: {
                    modmail_id_counter: botjson.modmail_id_counter,
                },
            },
        );
        // the_button
        await wheatley.updateOne(
            { id: "main" },
            {
                $set: {
                    "the_button.last_reset": botjson.the_button.last_reset,
                    "the_button.longest_time_without_reset": botjson.the_button.longest_time_without_reset,
                    "the_button.button_presses": botjson.the_button.button_presses,
                },
            },
        );
        const button_scoreboard = db.collection("button_scoreboard");
        for (const [k, v] of Object.entries(botjson.the_button.scoreboard)) {
            await button_scoreboard.insertOne({
                user: k,
                ...(v as any),
            });
        }
        await button_scoreboard.createIndex({ user: 1 }, { unique: true });
        await button_scoreboard.createIndex({ score: -1 });
        // buzzword-scoreboard
        const buzzword_scoreboard = db.collection("buzzword_scoreboard");
        for (const [k, v] of Object.entries(botjson["buzzword-scoreboard"].scores)) {
            await buzzword_scoreboard.insertOne({
                user: k,
                ...(v as any),
            });
        }
        await buzzword_scoreboard.createIndex({ user: 1 }, { unique: true });
        await buzzword_scoreboard.createIndex({ score: -1 });
        // starboard
        await wheatley.updateOne(
            { id: "main" },
            {
                $set: {
                    starboard: {
                        negative_emojis: botjson.starboard.negative_emojis,
                        delete_emojis: botjson.starboard.delete_emojis,
                        ignored_emojis: botjson.starboard.ignored_emojis,
                    },
                },
            },
        );
        const auto_delete_threshold_notifications = db.collection("auto_delete_threshold_notifications");
        for (const v of botjson.starboard.notified_about_auto_delete_threshold) {
            await auto_delete_threshold_notifications.insertOne({
                message: v,
            });
        }
        await auto_delete_threshold_notifications.createIndex({ message: 1 }, { unique: true });
        const starboard_entries = db.collection("starboard_entries");
        for (const [k, v] of Object.entries(botjson.starboard.starboard)) {
            await starboard_entries.insertOne({
                message: k,
                starboard_entry: v,
            });
        }
        await starboard_entries.createIndex({ message: 1 }, { unique: true });
    } catch (e) {
        console.error(e);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

main()
    .then(() => {})
    .catch(console.error);
