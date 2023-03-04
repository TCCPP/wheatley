import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { diff_to_human, M } from "../utils.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

export class Speedrun extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.wheatley.tracker.add_submodule({ on_ban: this.on_ban.bind(this) });
    }

    on_ban(ban: Discord.GuildBan, now: number) {
        M.debug("speedrun check");
        const user = ban.user;
        // get user info
        const avatar = user.displayAvatarURL();
        if(!this.wheatley.tracker.id_map.has(user.id)) {
            return; // If not in tracker, been in the server longer than 30 minutes
        }
        const entry = this.wheatley.tracker.id_map.get(user.id)!;
        if(entry.purged) {
            return; // ignore bans from !raidpurge
        }
        if(entry.joined_at == 0) {
            // ignore pseudo entries from anti-scambot, pseudo entries added when the user isn't in
            // the tracker already (i.e. longer than 30 minutes, not a speedrun)
            return;
        }
        M.log("Ban speedrun", diff_to_human(now - entry.joined_at), user.id, user.tag);
        // .purged set by raidpurge (yes I know it's checked above), currently_banning used by anti-scambot
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const is_auto_ban = entry.purged || this.wheatley.tracker.currently_banning.has(user.id);
        // make embed
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.speedrun_color)
            .setAuthor({
                name: `Speedrun attempt: ${user.tag}`,
                iconURL: avatar
            })
            .setDescription(`User <@${user.id}> joined at <t:${Math.round(entry.joined_at / 1000)}:T> and`
                            + ` banned at <t:${Math.round(now / 1000)}:T>.\n`
                            + `Final timer: ${diff_to_human(now - entry.joined_at)}.`
                            + (is_auto_ban ? "\n**AUTO BAN**" : ""))
            .setFooter({
                text: `ID: ${user.id}`
            })
            .setTimestamp();
        this.wheatley.action_log_channel.send({ embeds: [embed] });
    }
}
