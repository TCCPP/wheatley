import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { BotButton, ButtonInteractionBuilder } from "../../../command-abstractions/button.js";
import { colors } from "../../../common.js";
import { create_error_reply } from "../../../wheatley.js";

const CHANNELS_PER_PAGE = 10;

export default class GuildLookup extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private guild_lookup_page_button!: BotButton<[string, number]>;

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("guild", EarlyReplyMode.none)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Guild tools")
                .add_subcommand(
                    new TextBasedCommandBuilder("lookup", EarlyReplyMode.none)
                        .set_category("Admin utilities")
                        .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                        .set_description("Guild lookup")
                        .add_string_option({
                            title: "id",
                            description: "The guild id",
                            required: true,
                        })
                        .set_handler(this.lookup.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("invite", EarlyReplyMode.none)
                        .set_category("Admin utilities")
                        .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                        .set_description("Guild invite")
                        .add_string_option({
                            title: "id",
                            description: "The guild id",
                            required: true,
                        })
                        .set_handler(this.invite.bind(this)),
                ),
        );

        this.guild_lookup_page_button = commands.add(
            new ButtonInteractionBuilder("guild_lookup_page")
                // guild_id: string, page: number
                .add_string_metadata()
                .add_number_metadata()
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.handle_lookup_page.bind(this)),
        );
    }

    private async build_lookup_message(guild_id: string, page: number): Promise<Discord.BaseMessageOptions> {
        const guild = await this.wheatley.client.guilds.fetch(guild_id);
        await guild.channels.fetch();

        // guild.channels.cache can include threads (which don't have a position).
        // Sort primarily by position when available otherwise push to the end.
        const channels = [...guild.channels.cache.values()].sort((a, b) => {
            const pos_a =
                "rawPosition" in a && typeof (a as any).rawPosition === "number"
                    ? ((a as any).rawPosition as number)
                    : Number.MAX_SAFE_INTEGER;
            const pos_b =
                "rawPosition" in b && typeof (b as any).rawPosition === "number"
                    ? ((b as any).rawPosition as number)
                    : Number.MAX_SAFE_INTEGER;
            return pos_a - pos_b || a.id.localeCompare(b.id);
        });
        const pages = Math.ceil(channels.length / CHANNELS_PER_PAGE);
        const clamped_page = Math.min(Math.max(page, 0), Math.max(pages - 1, 0));

        const page_channels = channels.slice(clamped_page * CHANNELS_PER_PAGE, (clamped_page + 1) * CHANNELS_PER_PAGE);
        const lines = page_channels.map(channel => `${channel.id} ${channel.name}`);

        const embed = new Discord.EmbedBuilder()
            .setColor(colors.wheatley)
            .setTitle(
                pages > 1
                    ? `Guild lookup: ${guild.name} (page ${clamped_page + 1} of ${pages})`
                    : `Guild lookup: ${guild.name}`,
            )
            .setDescription(lines.length > 0 ? lines.join("\n") : "(no channels)")
            .setFooter({ text: `Guild ID: ${guild.id} | ${channels.length} channel(s)` });

        const buttons: Discord.ButtonBuilder[] = [];
        if (pages > 1 && clamped_page > 0) {
            buttons.push(
                this.guild_lookup_page_button
                    .create_button(guild.id, clamped_page - 1)
                    .setLabel("←")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (pages > 1 && clamped_page < pages - 1) {
            buttons.push(
                this.guild_lookup_page_button
                    .create_button(guild.id, clamped_page + 1)
                    .setLabel("→")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }

        return {
            embeds: [embed],
            components:
                buttons.length > 0
                    ? [
                          new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                              ...buttons,
                          ),
                      ]
                    : undefined,
            allowedMentions: { parse: [] },
        };
    }

    async lookup(command: TextBasedCommand, id: string) {
        const guild = await this.wheatley.client.guilds.fetch(id);
        await command.replyOrFollowUp(await this.build_lookup_message(guild.id, 0), true);
    }

    private async handle_lookup_page(interaction: Discord.ButtonInteraction, guild_id: string, page: number) {
        try {
            await interaction.deferUpdate();
            await interaction.message.edit(await this.build_lookup_message(guild_id, page));
        } catch (e) {
            const { embeds } = create_error_reply(`Error: ${e}`);
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({ ephemeral: true, embeds });
            } else {
                await interaction.reply({ ephemeral: true, embeds });
            }
        }
    }

    async invite(command: TextBasedCommand, id: string) {
        const guild = await this.wheatley.client.guilds.fetch(id);
        const invite = await guild.invites.create(
            [...guild.channels.cache.values().filter(channel => channel.isTextBased())][0].id,
            {
                maxAge: 18000,
                maxUses: 1,
            },
        );
        await command.reply(invite.url, true);
    }
}
