/**
 * Script to import historic monke button presses from archived log files.
 *
 * This script processes gzipped log files in the log_archive/ directory and extracts
 * all instances of monke button presses, inserting them into the database.
 *
 * Usage:
 *   npx tsx scripts/import-monke-presses.ts
 *
 * Requirements:
 *   - config.jsonc must exist with valid MongoDB credentials
 *   - log_archive/ directory must exist with .gz log files
 *
 * The script will:
 *   1. Connect to the database using credentials from config.jsonc
 *   2. Process all .gz files in log_archive/
 *   3. Decompress and parse log entries matching "Modmail log: <id> <name> Monkey pressed the button"
 *   4. Insert entries into the monke_button_presses collection
 *   5. Skip duplicates (same user + timestamp)
 *   6. Report statistics
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as readline from "readline";
import { promisify } from "util";
import moment from "moment";
import JSONC from "jsonc-parser";
import { WheatleyDatabase } from "../src/infra/database-interface.js";
import { wheatley_config } from "../src/wheatley.js";
import { monke_button_press_entry } from "../modules/wheatley/components/moderation/schemata.js";

const readdir = promisify(fs.readdir);

// Logged to log files since May 18, 2022 https://github.com/TCCPP/wheatley/commit/c4af42c137f1fee6aac780a4fe7ebdb9f14c2dc5
const LOG_PATTERNS = [
    // New format (with milliseconds): [2024.01.21 11:55:21.123]
    {
        regex: /\[(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\] \[log\]\s+Modmail log: (\d+) (.+?) Monkey pressed the button/,
        format: "YYYY.MM.DD HH:mm:ss.SSS",
    },
    // Old format (without milliseconds, 2-digit year): [01.21.24 11:55:21]
    {
        regex: /\[(\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})\] \[log\]\s+Modmail log: (\d+) (.+?) Monkey pressed the button/,
        format: "MM.DD.YY HH:mm:ss",
    },
] as const;

async function parse_gzipped_log(log_path: string): Promise<monke_button_press_entry[]> {
    const entries: monke_button_press_entry[] = [];

    console.log(`Processing log file: ${log_path}`);

    // Create a stream pipeline: read -> decompress -> readline
    const read_stream = fs.createReadStream(log_path);
    const gunzip_stream = zlib.createGunzip();
    const rl = readline.createInterface({
        input: read_stream.pipe(gunzip_stream),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        for (const { regex, format } of LOG_PATTERNS) {
            const match = line.match(regex);
            if (match) {
                const [, timestamp_str, user_id, username] = match;
                const timestamp = moment(timestamp_str, format).valueOf();
                entries.push({
                    user: user_id,
                    user_name: username,
                    timestamp,
                });
                break;
            }
        }
    }

    return entries;
}

async function main() {
    console.log("Starting historic monke button press import...");

    // Load config
    const config: wheatley_config = JSONC.parse(fs.readFileSync("config.jsonc", { encoding: "utf-8" }));

    if (!config.mongo) {
        console.error("Error: MongoDB credentials not found in config.jsonc");
        process.exit(1);
    }

    // Connect to database
    console.log("Connecting to database...");
    const database = await WheatleyDatabase.create(config.mongo);
    const collection = database.get_collection("monke_button_presses");

    // Find all .gz files in log_archive/
    const log_archive_dir = "log_archive";
    if (!fs.existsSync(log_archive_dir)) {
        console.error(`Error: ${log_archive_dir} directory not found`);
        await database.close();
        process.exit(1);
    }

    const files = await readdir(log_archive_dir);
    const log_files = files.filter(f => f.endsWith(".gz"));

    console.log(`Found ${log_files.length} log files to process`);

    let total_found = 0;
    let total_inserted = 0;
    let total_duplicates = 0;

    // Process each log file
    for (const log_file of log_files) {
        try {
            const log_path = path.join(log_archive_dir, log_file);
            const entries = await parse_gzipped_log(log_path);
            total_found += entries.length;

            console.log(`Found ${entries.length} monke button presses in ${log_file}`);

            // Insert entries, checking for duplicates
            for (const entry of entries) {
                const existing = await collection.findOne({
                    user: entry.user,
                    timestamp: entry.timestamp,
                });

                if (existing) {
                    total_duplicates++;
                } else {
                    await collection.insertOne(entry);
                    total_inserted++;
                }
            }
        } catch (error) {
            console.error(`Error processing ${log_file}:`, error);
        }
    }

    // Print summary
    console.log("\n=== Import Summary ===");
    console.log(`Total monke button presses found: ${total_found}`);
    console.log(`Total inserted into database: ${total_inserted}`);
    console.log(`Total duplicates skipped: ${total_duplicates}`);

    // Close database connection
    await database.close();
    console.log("\nImport complete!");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
