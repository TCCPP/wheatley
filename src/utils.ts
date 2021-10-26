import * as Discord from "discord.js";
import * as moment from "moment";
import * as chalk from "chalk";

export class M {
	static get_timestamp() {
		return moment().format("MM.DD.YY HH:mm:ss")
	}
	static log(...args: any[]) {
		process.stdout.write(`[${M.get_timestamp()}] [log]   `);
		console.log(...args);
	}
	static debug(...args: any[]) {
		process.stdout.write(`${chalk.gray(`[${M.get_timestamp()}] [debug]`)} `);
		console.log(...args);
	}
	static info(...args: any[]) {
		process.stdout.write(`${chalk.blueBright(`[${M.get_timestamp()}] [info] `)} `);
		console.log(...args);
	}
	static warn(...args: any[]) {
		process.stdout.write(`${chalk.yellowBright(`[${M.get_timestamp()}] [warn] `)} `);
		console.log(...args);
	}
	static error(...args: any[]) {
		process.stdout.write(`${chalk.redBright(`[${M.get_timestamp()}] [error]`)} `);
		console.log(...args);
		console.trace();
	}
};

export function send_long_message(channel: Discord.TextChannel, msg: string, callback: (m: Discord.Message) => void) {
	if(msg.length > 2000) {
		let lines = msg.split("\n");
		let partial = "";
		let queue: string[] = [];
		let first = true;
		while(lines.length > 0) {
			if(partial.length + lines[0].length + 1 <= 2000) {
				if(partial != "") partial += "\n";
				partial += lines.shift();
			} else {
				queue.push(partial);
				partial = "";
			}
		}
		if(partial != "") queue.push(partial);
		let send_next = () => {
			if(queue.length > 0) {
				channel.send(queue.shift()!)
				       .then(m => {
						   if(first) {
							   callback(m);
							   first = false;
						   }
						   send_next();
					   })
					   .catch(M.error);
			}
		};
		send_next();
	} else {
		channel.send(msg)
				.then(m => {
					callback(m);
				})
				.catch(M.error);
	}
}

const MINUTE = 60 * 1000;

function round(n: number, p: number) {
	return Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
}

function pluralize(n: number, word: string) {
	if(n == 1) {
		return `${round(n, 2)} ${word}`;
	} else {
		return `${round(n, 2)} ${word}s`;
	}
}

export function diff_to_human(diff: number) {
	if(diff >= MINUTE) {
		return `${pluralize(Math.floor(diff / MINUTE), "minute")} ${pluralize(diff % MINUTE / 1000, "second")}`;
	} else {
		return `${pluralize(diff / 1000, "second")}`;
	}
}

const code_re = /`[^\`]`/gi;

export function parse_out(message: string) {

}
