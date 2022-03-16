import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M, Mutex } from "./utils";
import * as fs from "fs";

export class DatabaseInterface {
	static readonly database_file = "bot.json";
	static readonly database_backup_file = "_bot.json";
	private fh: fs.promises.FileHandle;
	private state: { [key: string]: any };
	private write_mutex = new Mutex();
	private constructor() { this.fh = null as any; this.state = {}; }
	static async create() {
		let database = new DatabaseInterface();
		database.fh = await fs.promises.open(DatabaseInterface.database_file, "a+");
		let content = await database.fh.readFile({ encoding: "utf-8" });
		database.state = content == "" ? {} : JSON.parse(content);
		return database;
	}
	// TODO: Async this and also batch updates....
	async update() {
		await this.write_mutex.lock();
		M.debug("Saving database");
		let data = JSON.stringify(this.state, null, "\t");
		// copy before truncating / rewriting, paranoia in case of bot crash or power loss or whatnot
		await fs.promises.copyFile(DatabaseInterface.database_file, DatabaseInterface.database_backup_file);
		await this.fh.truncate(0);
		await this.fh.write(data, 0, "utf-8");
		this.write_mutex.unlock();
	}
	get<T>(key: string) {
		assert(this.has(key));
		return this.state[key] as T;
	}
	set<T>(key: string, value: T) {
		this.state[key] = value;
	}
	has(key: string) {
		return key in this.state;
	}
};
