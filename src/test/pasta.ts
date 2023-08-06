/** sensitive */
import { strict as assert } from "assert";
import * as Discord from "discord.js";
import { ContextMenuCommandBuilder } from "@discordjs/builders";

import { M, SelfClearingMap } from "../utils.js";
import { ApplicationCommandTypeMessage, is_authorized_admin, MINUTE, TCCPP_ID } from "../common.js";
import { GuildCommandManager } from "../infra/guild-command-manager.js";
import { decode_snowflake, forge_snowflake } from "../components/snowflake.js";

let client: Discord.Client;

let TCCPP: Discord.Guild;

const startpoint_map = new SelfClearingMap<string, [string, string]>(5 * MINUTE);

async function bulk_delete(
    channel: Discord.TextChannel,
    messages: Discord.Collection<string, Discord.Message<boolean>>,
    /* | Discord.MessageResolvable[]*/
) {
    //if(messages instanceof Discord.Collection) {
    assert(messages.size <= 100);
    if (messages.size >= 2) {
        return channel.bulkDelete(messages);
    } else {
        return Promise.all(messages.map(message => message.delete()));
    }
    //} else {
    //}
}

async function on_interaction_create(interaction: Discord.Interaction) {
    //
    // Purge count stuff
    //

    if (interaction.isMessageContextMenuCommand() && interaction.commandName == "Purge") {
        const modal = new Discord.ModalBuilder().setCustomId("purge_dialog").setTitle("Purge");
        const row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
            new Discord.TextInputBuilder()
                .setCustomId("purge_dialog_count")
                .setLabel("Codeword")
                .setPlaceholder("Number of messages")
                .setStyle(Discord.TextInputStyle.Short),
        );
        modal.addComponents(row);
        await interaction.showModal(modal);
    }

    //
    // Purge count stuff
    //

    if (interaction.isMessageContextMenuCommand() && interaction.commandName == "Purge count") {
        assert(interaction.guildId == TCCPP_ID);
        M.debug("purge count command started by", [interaction.user.id, interaction.user.username]);
        const modal = new Discord.ModalBuilder()
            .setCustomId(`purge_count_dialog::${interaction.channelId}::${interaction.targetId}`)
            .setTitle("Purge");
        const row = new Discord.ActionRowBuilder<Discord.TextInputBuilder>().addComponents(
            new Discord.TextInputBuilder()
                .setCustomId("purge_count_dialog_count")
                .setLabel("Count")
                .setPlaceholder("# of messages to purge")
                .setStyle(Discord.TextInputStyle.Short),
        );
        modal.addComponents(row);
        await interaction.showModal(modal);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("purge_count_dialog::")) {
        const interaction_data = interaction.customId.split("::");
        assert(interaction_data.length == 3);
        const [_, channelId, startMessageId] = interaction_data;

        const channel = (await TCCPP.channels.fetch(channelId)) as Discord.TextChannel;
        assert(channel);
        const count_str = interaction.fields.getTextInputValue("purge_count_dialog_count");
        if (isNaN(parseInt(count_str))) {
            await interaction.reply({
                ephemeral: true,
                content: `<@${interaction.user.id}> Purge failed: Input was non-numeric`,
            });
        } else {
            let count = Math.min(parseInt(count_str), Number.MAX_SAFE_INTEGER);
            M.debug(`purging ${count} messages`, [interaction.user.id, interaction.user.username]);
            await interaction.reply({
                ephemeral: true,
                content: `<@${interaction.user.id}> Purging`,
            });
            let after = forge_snowflake(decode_snowflake(startMessageId) - 1);
            const promises = [];
            while (count > 0) {
                const messages = await channel.messages.fetch({
                    after,
                    limit: Math.min(count, 100),
                    cache: false,
                });
                M.debug(`got ${messages.size} messages`);
                if (messages.size == 0) {
                    break;
                }
                after = messages
                    .map((_, k) => k)
                    .sort((a, b) => decode_snowflake(a) - decode_snowflake(b))
                    .at(-1)!;
                await bulk_delete(channel, messages);
                count -= messages.size;
            }
            M.debug("loop finished", count);
            await interaction.editReply({
                content: `<@${interaction.user.id}> Purge successful`,
            });
        }
    }
}

async function on_message(x: Discord.Message) {
    if (is_authorized_admin(x.author) && x.content == "!imagerole") {
        await x.reply("fuck");
        const members = await ((await x.channel.fetch()) as Discord.TextChannel).guild.members.fetch();
        for (const [_, member] of members) {
            M.debug("Adding image role to", member.user.tag);
            await member.roles.add("973705946448691220");
        }
    }
}

export async function setup_pasta(_client: Discord.Client, guild_command_manager: GuildCommandManager) {
    client = _client;
    const purge = new ContextMenuCommandBuilder()
        .setName("Purge")
        .setDefaultMemberPermissions(Discord.PermissionFlagsBits.Administrator)
        .setType(ApplicationCommandTypeMessage);
    //const purge_timeframe = new ContextMenuCommandBuilder()
    //    .setName("Purge timeframe")
    //    .setDefaultMemberPermissions(Discord.PermissionFlagsBits.Administrator)
    //    .setType(ApplicationCommandTypeMessage);
    const purge_count = new ContextMenuCommandBuilder()
        .setName("Purge count")
        .setDefaultMemberPermissions(Discord.PermissionFlagsBits.Administrator)
        .setType(ApplicationCommandTypeMessage);
    guild_command_manager.register(purge);
    //guild_command_manager.register(purge_timeframe);
    guild_command_manager.register(purge_count);
    client.on("ready", async () => {
        TCCPP = await client.guilds.fetch(TCCPP_ID);
        client.on("messageCreate", on_message);
        client.on("interactionCreate", on_interaction_create);
    });
}
