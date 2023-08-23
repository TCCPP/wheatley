import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M, build_description, pluralize, remove, time_to_human } from "../../utils.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley } from "../../wheatley.js";
import { moderation_entry, reply_with_error } from "./moderation-common.js";
import { colors } from "../../common.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "../../command-abstractions/text-based-command.js";

const moderations_per_page = 5;

/**
 * Implements !modlogs
 */
export default class Modlogs extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("modlogs")
                .set_description("Get user moderation logs. !modlogs <user>")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_user_option({
                    title: "user",
                    description: "User to get modlogs for",
                    required: true,
                })
                .set_handler(this.modlogs.bind(this)),
        );

        this.add_command(
            new TextBasedCommandBuilder("case")
                .set_description("Get case info. !case <case>")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to get information for",
                    required: true,
                })
                .set_handler(this.case_info.bind(this)),
        );
    }

    static moderation_description(moderation: moderation_entry) {
        return build_description([
            `**Type:** ${moderation.type}`,
            moderation.type === "rolepersist" ? `**Role:** <@&${moderation.role}>` : null,
            `**Moderator:** <@${moderation.moderator}>`,
            `**Issued At:** <t:${Math.round(moderation.issued_at / 1000)}:f> [link](${moderation.link})`,
            moderation.duration === null ? null : `**Duration:** ${time_to_human(moderation.duration)}`,
            `**Reason:** ${moderation.reason ? moderation.reason : "No reason provided"}`,
        ]);
    }

    static case_summary(moderation: moderation_entry, user: Discord.User) {
        return new Discord.EmbedBuilder()
            .setTitle(`Case ${moderation.case_number}`)
            .setAuthor({
                name: moderation.user_name,
                iconURL: user.avatarURL() ?? undefined,
            })
            .setColor(colors.wheatley)
            .setDescription(Modlogs.moderation_description(moderation))
            .setFields(
                remove(
                    [
                        moderation.removed
                            ? {
                                  name: "Removed",
                                  value: build_description([
                                      `**By:** <@${moderation.removed.moderator}>`,
                                      `**At:** <t:${Math.round(moderation.removed.timestamp / 1000)}:f>`,
                                      `**Reason:** ${
                                          moderation.removed.reason ? moderation.removed.reason : "No reason provided"
                                      }`,
                                  ]),
                              }
                            : null,
                        moderation.expunged
                            ? {
                                  name: "Expunged",
                                  value: build_description([
                                      `**By:** <@${moderation.expunged.moderator}>`,
                                      `**At:** <t:${Math.round(moderation.expunged.timestamp / 1000)}:f>`,
                                      `**Reason:** ${
                                          moderation.expunged.reason ? moderation.expunged.reason : "No reason provided"
                                      }`,
                                  ]),
                              }
                            : null,
                    ],
                    null,
                ),
            )
            .setFooter({
                text: `ID: ${moderation.user}`,
            });
    }

    // page is zero-indexed
    async modlogs_message(
        user: Discord.User,
        page: number,
    ): Promise<Discord.BaseMessageOptions & CommandAbstractionReplyOptions> {
        // TODO: Expunged or irrelevant? Show how things were removed / why?
        const moderations = await this.wheatley.database.moderations.find({ user: user.id, expunged: null }).toArray();
        const pages = Math.ceil(moderations.length / moderations_per_page);
        return {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle(`Modlogs for ${user.displayName} (page ${page + 1} of ${pages})`)
                    .setColor(colors.wheatley)
                    .setFields(
                        moderations
                            .slice(page * moderations_per_page, (page + 1) * moderations_per_page)
                            .map(moderation => {
                                return {
                                    name: `Case ${moderation.case_number}`,
                                    value: Modlogs.moderation_description(moderation),
                                };
                            }),
                    )
                    .setFooter({
                        text: `${pluralize(moderations.length, "log")}, ${pluralize(pages, "page")}`,
                    }),
            ],
            components:
                pages === 1
                    ? undefined
                    : [
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

    async case_info(command: TextBasedCommand, case_number: number) {
        M.log("Received case command");
        const moderation = await this.wheatley.database.moderations.findOne({ case_number });
        if (moderation) {
            await command.reply({
                embeds: [Modlogs.case_summary(moderation, await this.wheatley.client.users.fetch(moderation.user))],
            });
        } else {
            await reply_with_error(command, `Case ${case_number} not found`);
        }
    }
}
