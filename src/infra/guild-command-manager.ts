import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";

import * as util from "util";

import { critical_error, M } from "../utils.js";
import { Wheatley } from "../wheatley.js";

export class GuildCommandManager {
    commands: any = [];
    finalized = false;
    constructor(readonly wheatley: Wheatley) {}
    register(builder: any) {
        if (this.finalized) {
            throw Error("Commands registered too late");
        }
        this.commands.push(builder);
    }
    async finalize(token: string) {
        try {
            this.finalized = true;
            const rest = new REST({ version: "10" }).setToken(token);
            const route = this.wheatley.freestanding
                ? Routes.applicationGuildCommands(this.wheatley.id, this.wheatley.guildId)
                : Routes.applicationCommands(this.wheatley.id);

            M.log("Sending application commands");
            await rest.put(route, { body: this.commands });
            M.log("Finished sending commands");
        } catch (e) {
            M.log(util.inspect({ body: this.commands }, { showHidden: false, depth: null, colors: true }));
            critical_error(e);
        }
    }
}
