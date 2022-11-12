import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";

import * as util from "util";

import { critical_error, M } from "../utils";
import { TCCPP_ID, wheatley_id } from "../common";

export class GuildCommandManager {
    commands: any = [];
    finalized = false;
    register(builder: any) {
        if(this.finalized) {
            throw Error("Commands registered too late");
        }
        this.commands.push(builder);
    }
    async finalize(token: string) {
        try {
            this.finalized = true;
            const rest = new REST({ version: "10" }).setToken(token);
            M.log("Sending guild commands");
            await rest.put(
                Routes.applicationCommands(wheatley_id),
                { body: this.commands },
            );
            // Clear any previous guild commands
            await rest.put(
                Routes.applicationGuildCommands(wheatley_id, TCCPP_ID),
                { body: [] },
            );
            M.log("Finished sending guild commands");
        } catch(e) {
            M.log(util.inspect({ body: this.commands }, {showHidden: false, depth: null, colors: true}));
            critical_error(e);
        }
    }
}
