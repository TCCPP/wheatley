import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { build_description, truncate } from "../../utils/strings.js";
import { pluralize, time_to_human } from "../../utils/strings.js";
import { M } from "../../utils/debugging-and-logging.js";
import { BotComponent } from "../../bot-component.js";
import { Wheatley, WHEATLEY_ID } from "../../wheatley.js";
import { colors } from "../../common.js";
import { TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { CommandAbstractionReplyOptions, TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { remove } from "../../utils/arrays.js";
import { moderation_edit_info, moderation_entry } from "../../infra/schemata/moderation.js";
import { discord_timestamp } from "../../utils/discord.js";

const moderations_per_page = 5;

function is_autoremove(info: moderation_edit_info) {
    return info.reason == "Auto" && info.moderator == WHEATLEY_ID;
}

/**
 * Implements !modlogs
 */
export default class Modlogs extends BotComponent {
    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("modlogs")
                .set_description("Get user moderation logs")
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
                .set_description("Get case info")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to get information for",
                    required: true,
                })
                .set_handler(this.case_info.bind(this)),
        );
    }

    static moderation_description(moderation: moderation_entry, is_field = false) {
        // 256 chosen as an ideally generous padding to allow the preceding text before the reason to fit
        const max_reason = (is_field ? 1024 : 4096) - 256;
        const description = build_description(
            `**Type:** ${moderation.type}`,
            moderation.type === "rolepersist" ? `**Role:** <@&${moderation.role}>` : null,
            `**Moderator:** <@${moderation.moderator}>`,
            `**Issued At:** ${discord_timestamp(moderation.issued_at)} ${
                moderation.link ? `[link](${moderation.link})` : ""
            }`,
            moderation.duration === null ? null : `**Duration:** ${time_to_human(moderation.duration)}`,
            `**Reason:** ${moderation.reason ? truncate(moderation.reason, max_reason) : "No reason provided"}`,
            moderation.removed && !is_autoremove(moderation.removed)
                ? `**Removed:** ${discord_timestamp(moderation.removed.timestamp)}` +
                      ` by <@${moderation.removed.moderator}> ` +
                      `with reason: "${moderation.removed.reason ? truncate(moderation.removed.reason, 100) : "None"}"`
                : null,
        );
        return moderation.expunged ? `~~${description}~~` : description;
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
                                  value: truncate(
                                      build_description(
                                          `**By:** <@${moderation.removed.moderator}>`,
                                          `**At:** ${discord_timestamp(moderation.removed.timestamp)}`,
                                          `**Reason:** ${
                                              moderation.removed.reason
                                                  ? moderation.removed.reason
                                                  : "No reason provided"
                                          }`,
                                      ),
                                      1024,
                                  ),
                              }
                            : null,
                        moderation.expunged
                            ? {
                                  name: "Expunged",
                                  value: truncate(
                                      build_description(
                                          `**By:** <@${moderation.expunged.moderator}>`,
                                          `**At:** ${discord_timestamp(moderation.expunged.timestamp)}`,
                                          `**Reason:** ${
                                              moderation.expunged.reason
                                                  ? moderation.expunged.reason
                                                  : "No reason provided"
                                          }`,
                                      ),
                                      1024,
                                  ),
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
        const moderations = await this.wheatley.database.moderations
            .find({ user: user.id, expunged: null })
            .sort({ issued_at: -1 })
            .toArray();
        const pages = Math.ceil(moderations.length / moderations_per_page);
        const buttons: Discord.ButtonBuilder[] = [];
        if (pages <= 1) {
            // pass
        } else if (pages == 2) {
            buttons.push(
                new Discord.ButtonBuilder()
                    .setCustomId(`modlogs_page_${user.id}_${(page + 1) % pages}`)
                    .setLabel(page == 0 ? "🡆" : "🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        } else {
            buttons.push(
                new Discord.ButtonBuilder()
                    // a custom id can be up to 100 characters long
                    .setCustomId(`modlogs_page_${user.id}_${page === 0 ? pages - 1 : page - 1}`)
                    .setLabel("🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
                new Discord.ButtonBuilder()
                    .setCustomId(`modlogs_page_${user.id}_${(page + 1) % pages}`)
                    .setLabel("🡆")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        return {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle(`Modlogs for ${user.displayName} (page ${page + 1} of ${pages})`)
                    .setColor(colors.wheatley)
                    .setDescription(`<@${user.id}>`)
                    .setFields(
                        moderations
                            .slice(page * moderations_per_page, (page + 1) * moderations_per_page)
                            .map(moderation => {
                                return {
                                    name: `Case ${moderation.case_number}`,
                                    value: Modlogs.moderation_description(moderation, true),
                                };
                            }),
                    )
                    .setFooter({
                        text: `${pluralize(moderations.length, "log")}, ${pluralize(pages, "page")} | ID: ${user.id}`,
                    }),
            ],
            components:
                buttons.length == 0
                    ? undefined
                    : [
                          new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                              ...buttons,
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
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    // TODO: Code duplication
    async reply_with_error(command: TextBasedCommand, message: string) {
        await (command.replied && !command.is_editing ? command.followUp : command.reply).bind(command)({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.error} ***${message}***`),
            ],
        });
    }
}
