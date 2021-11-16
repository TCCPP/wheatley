import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { exists_sync, M } from "./utils";
import * as fs from "fs";

export class DatabaseInterface {
	readonly database_file = "bot.json";
	private fd: number;
	private state: any;
	constructor() {
		let creating = false;
		if(exists_sync(this.database_file)) {
			this.state = JSON.parse(fs.readFileSync(this.database_file, { encoding: "utf-8" }));
		} else {
			this.state = {};
			creating = true;
		}
		this.fd = fs.openSync(this.database_file, "a");
		if(creating) this.update();
	}
	// TODO: Async this and also batch updates....
	update() {
		M.debug("Saving database");
		let data = JSON.stringify(this.state);
		fs.ftruncateSync(this.fd, 0);
		fs.writeSync(this.fd, data, 0, "utf-8");
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
