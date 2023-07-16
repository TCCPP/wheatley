import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils.js";
import { colors, is_authorized_admin, pepereally, TCCPP_ID } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

const snowflake_re = /\b\d{10,}\b/g;

/**
 * Mass ban command.
 */
export class Massban extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    override async on_message_create(message: Discord.Message) {
        try {
            if(message.author.id == this.wheatley.client.user!.id) return; // Ignore self
            if(message.author.bot) return; // Ignore bots
            if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
            if(message.content.startsWith("!wban")) {
                assert(message.member != null);
                if(is_authorized_admin(message.member)) {
                    this.do_mass_ban(message);
                } else {
                    await message.reply(`Unauthorized ${pepereally}`);
                }
            }
        } catch(e) {
            critical_error(e);
        }
    }

    do_mass_ban(msg: Discord.Message) {
        // TODO: Do DM logic?
        // TODO: Set entry.purged if necessary?
        M.log("Got massban command");
        assert(msg.guild != null);
        const ids = msg.content.match(snowflake_re);
        if(ids != null && ids.length > 0) {
            M.debug("Banning...");
            msg.channel.send("Banning...");
            M.debug(ids);
            for(const id of ids) {
                msg.guild.members.ban(id, { reason: "[[Wheatley]] Manual mass-ban" });
            }
            msg.reply("Done.");
            // TODO: use long-message logic?
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.color)
                .setTitle(`<@!${msg.author.id}> banned ${ids.length} users`)
                .setDescription(`\`\`\`\n${ids.join("\n")}\n\`\`\``)
                .setTimestamp();
            this.wheatley.action_log_channel.send({ embeds: [embed] });
        }
    }
}
