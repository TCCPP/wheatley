import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../../../../utils/debugging-and-logging.js";
import { colors } from "../../../../common.js";
import { BotComponent } from "../../../../bot-component.js";
import { Wheatley } from "../../../../wheatley.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";

const snowflake_re = /\b\d{10,}\b/g;

export default class Massban extends BotComponent {
    private staff_action_log!: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.staff_action_log = await this.utilities.get_channel(
            this.wheatley.channels.staff_action_log.id,
            this.wheatley.channels.staff_action_log.name,
        );
    }
    override async on_message_create(message: Discord.Message) {
        try {
            // Ignore self, bots, and messages outside TCCPP (e.g. dm's)
            if (
                message.author.id == this.wheatley.user.id ||
                message.author.bot ||
                message.guildId != this.wheatley.guild.id
            ) {
                return;
            }
            if (message.content.startsWith("!wban")) {
                assert(message.member != null);
                if (await this.wheatley.check_permissions(message.member, Discord.PermissionFlagsBits.BanMembers)) {
                    await this.do_mass_ban(message);
                } else {
                    await message.reply(`Unauthorized ${this.wheatley.emoji.access_denied}`);
                }
            }
        } catch (e) {
            this.wheatley.critical_error(e);
        }
    }

    async do_mass_ban(msg: Discord.Message) {
        // TODO: Do DM logic?
        // TODO: Set entry.purged if necessary?
        M.log("Got massban command");
        assert(msg.guild != null);
        const ids = msg.content.match(snowflake_re);
        if (ids != null && ids.length > 0) {
            M.debug("Banning...");
            assert(!(msg.channel instanceof Discord.PartialGroupDMChannel));
            await msg.channel.send("Banning...");
            M.debug(ids);
            await Promise.all(ids.map(id => msg.guild!.members.ban(id, { reason: "[[Wheatley]] Manual mass-ban" })));
            await msg.reply("Done.");
            // TODO: use long-message logic?
            const embed = new Discord.EmbedBuilder()
                .setColor(colors.wheatley)
                .setTitle(`<@!${msg.author.id}> banned ${ids.length} users`)
                .setDescription(`\`\`\`\n${ids.join("\n")}\n\`\`\``)
                .setTimestamp();
            await this.staff_action_log.send({ embeds: [embed] });
        }
    }
}
