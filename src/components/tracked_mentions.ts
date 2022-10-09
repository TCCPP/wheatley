import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { critical_error, fetch_text_channel, M } from "../utility/utils";
import { action_log_channel_id, colors, moderators_role_id, root_role_id, TCCPP_ID } from "../common";

let client: Discord.Client;
let action_log_channel: Discord.TextChannel;

const tracked_mentions = new Set([
    "540314034894012428", // admin role on test server
    root_role_id,
    moderators_role_id,
    "892864085006360626", // red dragon
    "970549026514698284", // wheatly
    "1013953887029444678", // dyno
]);

function format_list(mentions: string[]) {
    if(mentions.length <= 2) {
        return mentions.join(" and ");
    } else {
        return `${mentions.slice(0, mentions.length - 1).join(", ")}, and ${mentions[mentions.length - 1]}`;
    }
}

function check_tracked_mention_and_notify(message: Discord.Message) {
    const mentions = [...new Set(message.mentions.roles.map(v => v.id).filter(id => tracked_mentions.has(id)))];
    if(mentions.length > 0) {
        const embed = new Discord.EmbedBuilder()
            .setColor(colors.color)
            .setAuthor({
                name: `${message.author.username}#${message.author.discriminator}`,
                iconURL: message.author.displayAvatarURL()
            })
            .setDescription(`${format_list(mentions.map(m => `<@&${m}>`))} mentioned in`
                            + ` <#${message.channel.id}> by <@${message.author.id}>\n`
                            + `[click here to jump](${message.url})`)
            .setFooter({
                text: `ID: ${message.author.id}`
            })
            .setTimestamp();
        action_log_channel.send({ embeds: [embed] });
    }
}

function on_message(message: Discord.Message) {
    try {
        if(message.author.id == client.user!.id) return; // Ignore self
        if(message.author.bot) return; // Ignore bots
        if(message.guildId != TCCPP_ID) return; // Ignore messages outside TCCPP (e.g. dm's)
        if(message.mentions.roles.size > 0) {
            check_tracked_mention_and_notify(message);
        }
    } catch(e) {
        critical_error(e);
    }
}

export async function setup_tracked_mentions(_client: Discord.Client) {
    client = _client;
    M.debug("Setting up tracked_mentions");
    client.on("ready", async () => {
        try {
            action_log_channel = await fetch_text_channel(action_log_channel_id);
            M.debug("tracked_mentions: action_log_channel channel fetched");
            client.on("messageCreate", on_message);
            //tracker.add_submodule({ });
        } catch(e) {
            critical_error(e);
        }
    });
}
