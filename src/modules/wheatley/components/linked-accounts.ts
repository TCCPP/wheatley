import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { colors } from "../../../common.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { build_description } from "../../../utils/strings.js";
import { unwrap } from "../../../utils/misc.js";
import { moderation_entry } from "./moderation/schemata.js";
import { channel_map } from "../../../channel-map.js";

type linked_accounts_entry = {
    main_account: string;
    alt_account: string;
    added_by: string;
    added_by_name: string;
    added_at: number;
    context?: string;
};

export default class LinkedAccounts extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private database = this.wheatley.database.create_proxy<{
        linked_accounts: linked_accounts_entry;
    }>();
    private channels = channel_map(this.wheatley, this.wheatley.channels.staff_action_log);

    override async setup(commands: CommandSetBuilder) {
        await ensure_index(this.wheatley, this.database.linked_accounts, { alt_account: 1 }, { unique: true });
        await ensure_index(this.wheatley, this.database.linked_accounts, { main_account: 1 });
        await this.channels.resolve();

        this.wheatley.event_hub.on("issue_moderation", (moderation: moderation_entry) => {
            this.on_moderation_issue(moderation).catch(this.wheatley.critical_error.bind(this.wheatley));
        });
        commands.add(
            new TextBasedCommandBuilder("alt", EarlyReplyMode.visible)
                .set_category("Moderation Utilities")
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Manage linked accounts")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.visible)
                        .set_description("Link two accounts")
                        .add_user_option({
                            title: "user",
                            description: "First user",
                            required: true,
                        })
                        .add_user_option({
                            title: "alt",
                            description: "Second user (alt account)",
                            required: true,
                        })
                        .add_string_option({
                            title: "context",
                            description: "Context or reason for linking",
                            required: false,
                        })
                        .set_handler(this.add_link.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove", EarlyReplyMode.visible)
                        .set_description("Unlink two accounts")
                        .add_user_option({
                            title: "user",
                            description: "First user",
                            required: true,
                        })
                        .add_user_option({
                            title: "alt",
                            description: "Second user (alt account)",
                            required: true,
                        })
                        .set_handler(this.remove_link.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("list", EarlyReplyMode.visible)
                        .set_description("List all linked accounts for a user")
                        .add_user_option({
                            title: "user",
                            description: "User to check",
                            required: true,
                        })
                        .set_handler(this.list_links.bind(this)),
                ),
        );
    }

    async find_main_account(user_id: string): Promise<string> {
        const as_alt = await this.database.linked_accounts.findOne({ alt_account: user_id });
        if (as_alt) {
            return as_alt.main_account;
        }
        return user_id;
    }

    async get_all_accounts_in_group(main_account: string): Promise<Set<string>> {
        const alts = await this.database.linked_accounts.find({ main_account }).toArray();
        const accounts = new Set<string>([main_account]);
        for (const alt of alts) {
            accounts.add(alt.alt_account);
        }
        return accounts;
    }

    async get_all_linked_accounts(user_id: string): Promise<Set<string>> {
        const main_account = await this.find_main_account(user_id);
        const alts = await this.database.linked_accounts.find({ main_account }).toArray();
        const linked = new Set<string>();
        if (main_account !== user_id) {
            linked.add(main_account);
        }
        for (const alt of alts) {
            if (alt.alt_account !== user_id) {
                linked.add(alt.alt_account);
            }
        }
        return linked;
    }

    async has_alts(user_id: string): Promise<boolean> {
        const main_account = await this.find_main_account(user_id);
        const count = await this.database.linked_accounts.countDocuments({ main_account: main_account });
        return count > 0 || main_account !== user_id;
    }

    create_entry(
        main_account: string,
        alt_account: string,
        moderator_id: string,
        moderator_name: string,
        context: string | null,
    ): linked_accounts_entry {
        return {
            main_account,
            alt_account,
            added_by: moderator_id,
            added_by_name: moderator_name,
            added_at: Date.now(),
            context: context ?? undefined,
        };
    }

    async add_link(command: TextBasedCommand, user: Discord.User, alt: Discord.User, context: string | null) {
        if (user.id === alt.id) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setDescription(`${this.wheatley.emoji.error} Cannot link a user to themselves`),
                ],
            });
            return;
        }
        const user_main = await this.find_main_account(user.id);
        const alt_main = await this.find_main_account(alt.id);
        if (user_main === alt_main) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setDescription(`${this.wheatley.emoji.error} These accounts are already linked`),
                ],
            });
            return;
        }
        const user_group = await this.get_all_accounts_in_group(user_main);
        const alt_group = await this.get_all_accounts_in_group(alt_main);
        const all_accounts = new Set([...user_group, ...alt_group]);
        await this.database.linked_accounts.deleteMany({ main_account: alt_main });
        const moderator = await command.get_member();
        const entries = Array.from(all_accounts)
            .filter(id => id !== user_main)
            .map(id => this.create_entry(user_main, id, command.user.id, moderator.displayName, context));
        await this.database.linked_accounts.insertMany(entries);
        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setDescription(
                        build_description(
                            `${this.wheatley.emoji.success} Linked accounts: <@${user.id}> ↔ <@${alt.id}>`,
                            context ? `Context: ${context}` : null,
                        ),
                    ),
            ],
        });
        M.log("Linked accounts", user.id, alt.id, "by", command.user.id);
    }

    async remove_link(command: TextBasedCommand, user: Discord.User, alt: Discord.User) {
        const user_main = await this.find_main_account(user.id);
        const alt_main = await this.find_main_account(alt.id);

        if (user_main !== alt_main) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setDescription(`${this.wheatley.emoji.error} These accounts are not linked`),
                ],
            });
            return;
        }

        const result = await this.database.linked_accounts.deleteOne({
            main_account: user_main,
            alt_account: { $in: [user.id, alt.id] },
        });

        if (result.deletedCount === 0) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.alert_color)
                        .setDescription(`${this.wheatley.emoji.error} No direct link found between these accounts`),
                ],
            });
            return;
        }

        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setDescription(
                        `${this.wheatley.emoji.success} Removed link between <@${user.id}> and <@${alt.id}>`,
                    ),
            ],
        });

        M.log("Unlinked accounts", user.id, alt.id, "by", command.user.id);
    }

    async list_links(command: TextBasedCommand, user: Discord.User) {
        const linked_accounts = await this.get_all_linked_accounts(user.id);

        if (linked_accounts.size === 0) {
            await command.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(`<@${user.id}> has no linked accounts`),
                ],
            });
            return;
        }

        const account_mentions = Array.from(linked_accounts)
            .map(id => `<@${id}>`)
            .join(", ");

        await command.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(colors.wheatley)
                    .setTitle(`Linked accounts for ${user.tag}`)
                    .setDescription(
                        build_description(
                            `**User:** <@${user.id}>`,
                            `**Linked accounts (${linked_accounts.size}):** ${account_mentions}`,
                        ),
                    )
                    .setFooter({
                        text: `ID: ${user.id}`,
                    }),
            ],
        });
    }

    async on_moderation_issue(moderation: moderation_entry) {
        const linked_accounts = await this.get_all_linked_accounts(moderation.user);

        if (linked_accounts.size > 0) {
            const account_mentions = Array.from(linked_accounts)
                .map(id => `<@${id}>`)
                .join(", ");

            const description =
                `⚠️ User <@${moderation.user}> has ${linked_accounts.size} linked account: ` + `${account_mentions}`;
            await this.channels.staff_action_log.send({
                embeds: [new Discord.EmbedBuilder().setColor(colors.alert_color).setDescription(description)],
            });
        }
    }
}
