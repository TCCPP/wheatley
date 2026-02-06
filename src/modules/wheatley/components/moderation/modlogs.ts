import { strict as assert } from "assert";

import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { build_description, truncate } from "../../../../utils/strings.js";
import { pluralize, time_to_human } from "../../../../utils/strings.js";
import { M } from "../../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import { BotButton, ButtonInteractionBuilder } from "../../../../command-abstractions/button.js";
import { Wheatley } from "../../../../wheatley.js";
import { colors } from "../../../../common.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import {
    CommandAbstractionReplyOptions,
    TextBasedCommand,
} from "../../../../command-abstractions/text-based-command.js";
import { remove } from "../../../../utils/arrays.js";
import { moderation_entry, voice_moderation_types } from "./schemata.js";
import { discord_timestamp } from "../../../../utils/discord.js";
import { unwrap } from "../../../../utils/misc.js";
import LinkedAccounts from "../linked-accounts.js";

export type modlog_display_options = {
    show_private_logs: boolean;
    show_moderator: boolean;
};

export const staff_moderation_display_options: modlog_display_options = {
    show_private_logs: true,
    show_moderator: true,
};
export const public_moderation_display_options: modlog_display_options = {
    show_private_logs: false,
    show_moderator: false,
};

const moderations_per_page = 5;

export default class Modlogs extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        moderations: moderation_entry;
    }>();

    private modlogs_page_button!: BotButton<[string, number]>;
    private linked_accounts!: LinkedAccounts;

    override async setup(commands: CommandSetBuilder) {
        this.linked_accounts = unwrap(this.wheatley.components.get("LinkedAccounts")) as LinkedAccounts;
        commands.add(
            new TextBasedCommandBuilder("modlogs", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_description("Get user moderation logs")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_user_option({
                    title: "user",
                    description: "User to get modlogs for",
                    required: true,
                })
                .set_handler(this.modlogs.bind(this)),
        );

        commands.add(
            new TextBasedCommandBuilder("case", EarlyReplyMode.visible)
                .set_category("Moderation")
                .set_description("Get case info")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_number_option({
                    title: "case",
                    description: "Case to get information for",
                    required: true,
                })
                .set_handler(this.case_info.bind(this)),
        );

        // Register button handler for modlogs pagination
        this.modlogs_page_button = commands.add(
            new ButtonInteractionBuilder("modlogs_page")
                .add_user_id_metadata() // user_id: string
                .add_number_metadata() // page: number
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .set_handler(this.handle_modlogs_page.bind(this)),
        );
    }

    static moderation_description(moderation: moderation_entry, is_field: boolean, options: modlog_display_options) {
        // 256 chosen as an ideally generous padding to allow the preceding text before the reason to fit
        const max_reason = (is_field ? 1024 : 4096) - 256;
        const description = build_description(
            `**Type:** ${moderation.type}`,
            moderation.type === "rolepersist" ? `**Role:** <@&${moderation.role}>` : null,
            options.show_moderator ? `**Moderator:** <@${moderation.moderator}>` : null,
            `**Issued At:** ${discord_timestamp(moderation.issued_at)} ${
                moderation.link ? `[link](${moderation.link})` : ""
            }`,
            moderation.duration === null ? null : `**Duration:** ${time_to_human(moderation.duration)}`,
            `**Reason:** ${moderation.reason ? truncate(moderation.reason, max_reason) : "No reason provided"}`,
            moderation.removed && !moderation.auto_removed
                ? `**Removed:** ${discord_timestamp(moderation.removed.timestamp)}` +
                      (options.show_moderator ? ` by <@${moderation.removed.moderator}>` : "") +
                      ` with reason: "${moderation.removed.reason ? truncate(moderation.removed.reason, 100) : "None"}"`
                : null,
            moderation.context && options.show_private_logs ? `**Context:** ${moderation.context.join(", ")}` : null,
        );
        return moderation.expunged ? `~~${description}~~` : description;
    }

    static get_display_options(
        channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel,
        moderation: moderation_entry,
    ): modlog_display_options {
        const is_mod_only = Modlogs.is_mod_only(channel);
        const is_voice_mod_channel = Modlogs.is_voice_mod_channel(channel);
        const is_voice_moderation = voice_moderation_types.includes(moderation.type);
        return {
            show_private_logs: is_mod_only,
            show_moderator: is_mod_only || (is_voice_mod_channel && is_voice_moderation),
        };
    }

    static case_summary(moderation: moderation_entry, user: Discord.User, options: modlog_display_options) {
        return new Discord.EmbedBuilder()
            .setTitle(`Case ${moderation.case_number}`)
            .setAuthor(
                options.show_private_logs
                    ? {
                          name: moderation.user_name,
                          iconURL: user.avatarURL() ?? undefined,
                      }
                    : null,
            )
            .setColor(colors.wheatley)
            .setDescription(Modlogs.moderation_description(moderation, false, options))
            .setFields(
                remove(
                    [
                        moderation.removed
                            ? {
                                  name: "Removed",
                                  value: truncate(
                                      build_description(
                                          options.show_moderator ? `**By:** <@${moderation.removed.moderator}>` : null,
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
                                          options.show_moderator ? `**By:** <@${moderation.expunged.moderator}>` : null,
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
            .setFooter(
                options.show_private_logs
                    ? {
                          text: `ID: ${moderation.user}`,
                      }
                    : null,
            );
    }

    // page is zero-indexed
    async modlogs_message(
        user: Discord.User,
        page: number,
        channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel,
    ): Promise<Discord.BaseMessageOptions & CommandAbstractionReplyOptions> {
        const is_mod_only = Modlogs.is_mod_only(channel);
        const linked_accounts = is_mod_only
            ? await this.linked_accounts.get_all_linked_accounts(user.id)
            : new Set([user.id]);
        const all_user_ids = [user.id, ...Array.from(linked_accounts)];

        const query: mongo.Filter<moderation_entry> = { user: { $in: all_user_ids }, expunged: null };
        if (!is_mod_only) {
            query.type = { $ne: "note" };
        }
        const moderations = await this.database.moderations.find(query).sort({ issued_at: -1 }).toArray();
        const pages = Math.ceil(moderations.length / moderations_per_page);
        const buttons: Discord.ButtonBuilder[] = [];
        if (pages <= 1) {
            // pass
        } else if (pages == 2) {
            buttons.push(
                this.modlogs_page_button
                    .create_button(user.id, (page + 1) % pages)
                    .setLabel(page == 0 ? "🡆" : "🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        } else {
            buttons.push(
                this.modlogs_page_button
                    .create_button(user.id, page === 0 ? pages - 1 : page - 1)
                    .setLabel("🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
                this.modlogs_page_button
                    .create_button(user.id, (page + 1) % pages)
                    .setLabel("🡆")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        const has_linked_accounts = linked_accounts.size > 0;
        const title_suffix = has_linked_accounts && is_mod_only ? " & Linked Accounts" : "";
        const description_parts = [`<@${user.id}>`];
        if (has_linked_accounts && is_mod_only) {
            const account_mentions = Array.from(linked_accounts)
                .map(id => `<@${id}>`)
                .join(", ");
            description_parts.push(`**Linked Accounts (${linked_accounts.size}):** ${account_mentions}`);
        }

        return {
            embeds: [
                new Discord.EmbedBuilder()
                    .setTitle(`Modlogs for ${user.displayName}${title_suffix} (page ${page + 1} of ${pages})`)
                    .setColor(colors.wheatley)
                    .setDescription(build_description(...description_parts))
                    .setFields(
                        moderations
                            .slice(page * moderations_per_page, (page + 1) * moderations_per_page)
                            .map(moderation => ({
                                name:
                                    has_linked_accounts && moderation.user !== user.id
                                        ? `Case ${moderation.case_number} (${moderation.user_name})`
                                        : `Case ${moderation.case_number}`,
                                value: Modlogs.moderation_description(
                                    moderation,
                                    true,
                                    Modlogs.get_display_options(channel, moderation),
                                ),
                            })),
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

    private static get_min_viewable_permissions(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        if (channel.isDMBased() || !channel.parent) {
            return 0n;
        }
        return channel.guild.roles.cache
            .mapValues(role => channel.permissionsFor(role).bitfield)
            .reduce((accumulator, value) => {
                if (value & Discord.PermissionFlagsBits.ViewChannel) {
                    return accumulator & value;
                }
                return accumulator;
            }, Discord.PermissionsBitField.All);
    }

    static is_mod_only(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        const min_permissions = Modlogs.get_min_viewable_permissions(channel);
        return (min_permissions & Discord.PermissionFlagsBits.ModerateMembers) != 0n;
    }

    static is_voice_mod_channel(channel: Discord.GuildTextBasedChannel | Discord.TextBasedChannel) {
        const min_permissions = Modlogs.get_min_viewable_permissions(channel);
        return (min_permissions & Discord.PermissionFlagsBits.MuteMembers) != 0n;
    }

    async modlogs(command: TextBasedCommand, user: Discord.User) {
        const channel = await command.get_channel();
        await command.reply(await this.modlogs_message(user, 0, channel));
    }

    // Handle modlogs page button interactions
    async handle_modlogs_page(interaction: Discord.ButtonInteraction, user_id: string, page: number) {
        const user = await this.wheatley.client.users.fetch(user_id);
        const channel = interaction.channel as Discord.GuildTextBasedChannel;
        await interaction.message.edit(await this.modlogs_message(user, page, channel));
        await interaction.deferUpdate();
    }

    async case_info(command: TextBasedCommand, case_number: number) {
        const moderation = await this.get_case(case_number);
        if (moderation) {
            const channel = await command.get_channel();
            await command.reply({
                embeds: [
                    Modlogs.case_summary(
                        moderation,
                        await this.wheatley.client.users.fetch(moderation.user),
                        Modlogs.get_display_options(channel, moderation),
                    ),
                ],
            });
        } else {
            await this.reply_with_error(command, `Case ${case_number} not found`);
        }
    }

    async get_case(case_number: number) {
        return await this.database.moderations.findOne({ case_number });
    }

    // TODO: Code duplication
    async reply_with_error(command: TextBasedCommand, message: string) {
        await command.replyOrFollowUp({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.alert_color)
                    .setDescription(`${this.wheatley.emoji.error} ***${message}***`),
            ],
        });
    }
}
