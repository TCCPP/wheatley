import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M, build_description, pluralize, remove, time_to_human } from "../../utils.js";
import { colors } from "../../common.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { CommandAbstractionReplyOptions, TextBasedCommand, TextBasedCommandBuilder } from "../../command.js";

const moderations_per_page = 5;

/**
 * Implements !modlogs
 */
export default class Modlogs extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("wmodlogs")
                .set_description("Get user moderation logs")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_user_option({
                    title: "user",
                    description: "User to get modlogs for",
                    required: true,
                })
                .set_handler(this.modlogs.bind(this)),
        );
    }

    // page is zero-indexed
    async modlogs_message(
        user: Discord.User,
        page: number,
    ): Promise<Discord.BaseMessageOptions & CommandAbstractionReplyOptions> {
        const moderations = await this.wheatley.database.moderations.find({ user: user.id }).toArray();
        const pages = Math.ceil(moderations.length / moderations_per_page);
        return {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle(`Modlogs for ${user.displayName} (page ${page + 1} of ${pages})`)
                    .setFields(
                        moderations
                            .slice(page * moderations_per_page, (page + 1) * moderations_per_page)
                            .map(moderation => {
                                return {
                                    name: `Case ${moderation.case_number}`,
                                    value: build_description([
                                        `**Type:** ${moderation.type}`,
                                        `**Moderator:** <@${moderation.moderator}>`,
                                        `**Issued At:** <t:${Math.round(moderation.issued_at / 1000)}:f>`,
                                        moderation.duration === null
                                            ? null
                                            : `**Duration:** ${time_to_human(moderation.duration)}`,
                                        `**Reason:** ${moderation.reason ? moderation.reason : "No reason provided"}`,
                                    ]),
                                };
                            }),
                    )
                    .setFooter({
                        text: `${pluralize(moderations.length, "log")}, ${pluralize(pages, "page")}`,
                    }),
            ],
            components: [
                new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                    new Discord.ButtonBuilder()
                        // a custom id can be up to 100 characters long
                        .setCustomId(`modlogs_page_${user.id}_${page === 0 ? pages - 1 : page - 1}`)
                        .setLabel("🡄")
                        .setStyle(Discord.ButtonStyle.Primary),
                    new Discord.ButtonBuilder()
                        .setCustomId(`modlogs_page_${user.id}_${(page + 1) % pages}`)
                        .setLabel("🡆")
                        .setStyle(Discord.ButtonStyle.Primary),
                ),
            ],
        };
    }

    async modlogs(command: TextBasedCommand, user: Discord.User) {
        M.log("Received modlogs command");
        await command.reply(await this.modlogs_message(user, 0));
    }

    override async on_interaction_create(interaction: Discord.Interaction<Discord.CacheType>) {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith("modlogs_page_")) {
                if (!this.wheatley.is_authorized_mod(interaction.user)) {
                    await interaction.reply({
                        content: "Error: You are not authorized",
                        ephemeral: true,
                    });
                    return;
                }
                const [user, page] = interaction.customId.substring("modlogs_page_".length).split("_");
                await interaction.message.edit(
                    await this.modlogs_message(await this.wheatley.client.users.fetch(user), parseInt(page)),
                );
                await interaction.deferUpdate();
            }
        }
    }
}
