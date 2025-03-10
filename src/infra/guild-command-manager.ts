import { REST } from "@discordjs/rest";
import * as Discord from "discord.js";

import * as util from "util";

import { M } from "../utils/debugging-and-logging.js";
import { Wheatley } from "../wheatley.js";

export class GuildCommandManager {
    commands: (Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder)[] = [];
    finalized = false;
    constructor(readonly wheatley: Wheatley) {}
    register(builder: Discord.SlashCommandBuilder | Discord.ContextMenuCommandBuilder | undefined) {
        if (this.finalized) {
            throw Error("Commands registered too late");
        }
        if (builder) {
            this.commands.push(builder);
        }
    }
    async finalize(token: string) {
        try {
            this.finalized = true;
            const rest = new REST({ version: "10" }).setToken(token);
            const route = this.wheatley.freestanding
                ? Discord.Routes.applicationGuildCommands(this.wheatley.id, this.wheatley.guildId)
                : Discord.Routes.applicationCommands(this.wheatley.id);

            this.wheatley.info(`Registering ${this.commands.length} application commands`);
            M.log(
                "Sending application commands:",
                this.commands.length,
                this.commands.map(builder => builder.name),
            );
            await rest.put(route, { body: this.commands });
            M.log("Finished sending commands");
        } catch (e) {
            M.log(util.inspect({ body: this.commands }, { showHidden: false, depth: null, colors: true }));
            this.wheatley.critical_error(e);
        }
    }
}
