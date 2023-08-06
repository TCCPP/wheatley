/** sensitive */
import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, M } from "../utils.js";
import { is_authorized_admin, TCCPP_ID } from "../common.js";

let client: Discord.Client;

function on_message(message: Discord.Message) {
    if (message.author.id == client.user!.id) return; // Ignore self
    if (message.author.bot) return; // Ignore bots
    if (message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
    if (message.content == "!wtest") {
        assert(message.member != null);
        if (is_authorized_admin(message.member)) {
            /*message.reply("test");
            const embed = new Discord.MessageEmbed()
                .setColor(colors.color)
                .setAuthor(`${message.author.username}#${message.author.discriminator}`,
                           message.author.displayAvatarURL())
                .setDescription("test test")
                .setFooter(`ID: ${message.author.id}`)
                .setTimestamp();
            message.channel.send({ embeds: [embed] });*/
            for (let i = 0; i < 202; i++) {
                message.channel.send(`${i}`).catch(critical_error);
            }
        }
    }
}

export async function setup_test_command(_client: Discord.Client) {
    client = _client;
    client.on("messageCreate", on_message);
}
