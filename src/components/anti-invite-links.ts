import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { departialize } from "../utils/discord.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { BotButton, ButtonInteractionBuilder } from "../command-abstractions/button.js";

const INVITE_RE =
    /(?:(?:discord(?:app)?|disboard)\.(?:gg|(?:com|org|me)\/(?:invite|server\/join))|(?<!\w)\.gg)\/(\S+)/i;

export function match_invite(content: string): string | null {
    const match = content.match(INVITE_RE);
    return match ? match[1] : null;
}

type allowed_invite_entry = {
    guild_id: string;
    guild_name: string;
    icon_url?: string;
    url: string;
};

export default class AntiInviteLinks extends BotComponent {
    private allowed_guilds = new Set<string>();

    private staff_flag_log!: Discord.TextChannel;

    private database = this.wheatley.database.create_proxy<{
        allowed_invites: allowed_invite_entry;
    }>();

    private allowed_invites_page_button!: BotButton<[number]>;

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);

        commands.add(
            new TextBasedCommandBuilder("allowed-invites", EarlyReplyMode.ephemeral)
                .set_category("Admin utilities")
                .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
                .set_description("Manage allowed server invites")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.Administrator)
                        .set_description("Add allowed invite")
                        .add_string_option({
                            title: "invite",
                            description: "invite code or url for the guild to add",
                            required: true,
                        })
                        .set_handler(this.handle_add.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.Administrator)
                        .set_description("Remove allowed invite")
                        .add_string_option({
                            title: "guild-id",
                            description: "guild to remove",
                            required: true,
                        })
                        .set_handler(this.handle_remove.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("list", EarlyReplyMode.ephemeral)
                        .set_description("list all allowed server invites")
                        .set_handler(this.handle_list.bind(this)),
                ),
        );

        this.allowed_invites_page_button = commands.add(
            new ButtonInteractionBuilder("allowed_invites_page")
                .add_number_metadata()
                .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
                .set_handler(this.handle_page.bind(this)),
        );
    }

    override async on_ready() {
        this.allowed_guilds = new Set((await this.database.allowed_invites.find().toArray()).map(e => e.guild_id));
    }

    private static build_guild_embed(entry: allowed_invite_entry) {
        return new Discord.EmbedBuilder()
            .setAuthor({
                name: entry.guild_name,
                url: entry.url,
                iconURL: entry.icon_url,
            })
            .setFooter({ text: entry.guild_id });
    }

    private async handle_add(command: TextBasedCommand, resolvable: Discord.InviteResolvable) {
        try {
            M.log("Adding ", resolvable, " to allowed invites");
            const invite = await this.wheatley.client.fetchInvite(resolvable);
            if (invite.guild == null) {
                throw Error("not a Guild invite");
            }
            const res = await this.database.allowed_invites.findOneAndUpdate(
                { guild_id: invite.guild.id },
                {
                    $set: {
                        guild_id: invite.guild.id,
                        guild_name: invite.guild.name,
                        icon_url: invite.guild.iconURL() ?? undefined,
                        url: invite.url,
                    },
                },
                { upsert: true, returnDocument: "after" },
            );
            if (res == null) {
                await command.react("🤷", true);
                return;
            }
            this.allowed_guilds.add(res.guild_id);
            await command.replyOrFollowUp({
                embeds: [AntiInviteLinks.build_guild_embed(res)],
            });
        } catch (e) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} ${e}`, true);
        }
    }

    private async handle_remove(command: TextBasedCommand, guild_id: string) {
        M.log("Removing ", guild_id, " from allowed invites");
        const res = await this.database.allowed_invites.findOneAndDelete({ guild_id: guild_id });
        if (res == null) {
            await command.react("🤷", true);
            return;
        }
        this.allowed_guilds.delete(res.guild_id);
        await command.react(this.wheatley.emoji.success, true);
    }

    private async build_list_message(page: number): Promise<Discord.BaseMessageOptions> {
        const max_entries_per_page = 10;
        const invites = await this.database.allowed_invites.find().toArray();
        const pages = Math.ceil(invites.length / max_entries_per_page);
        page = Math.min(Math.max(page, 0), pages - 1);
        const page_buttons: Discord.ButtonBuilder[] = [];
        if (page > 0) {
            page_buttons.push(
                this.allowed_invites_page_button
                    .create_button(page - 1)
                    .setLabel("🡄")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (page < pages - 1) {
            page_buttons.push(
                this.allowed_invites_page_button
                    .create_button(page + 1)
                    .setLabel("🡆")
                    .setStyle(Discord.ButtonStyle.Primary),
            );
        }
        if (invites.length > 0) {
            return {
                embeds: invites
                    .slice(page * max_entries_per_page, page * max_entries_per_page + max_entries_per_page)
                    .map(AntiInviteLinks.build_guild_embed),
                components:
                    page_buttons.length > 0
                        ? [
                              new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
                                  ...page_buttons,
                              ),
                          ]
                        : undefined,
            };
        } else {
            return {
                content: "📂 currently no allowed invites",
            };
        }
    }

    private async handle_list(command: TextBasedCommand) {
        await command.replyOrFollowUp(await this.build_list_message(0));
    }

    private async handle_page(interaction: Discord.ButtonInteraction, page: number) {
        await interaction.message.edit(await this.build_list_message(page));
        await interaction.deferUpdate();
    }

    private async is_allowed(code: Discord.InviteResolvable) {
        try {
            const invite = await this.wheatley.client.fetchInvite(code);
            if (invite.guild == null) {
                return false;
            }
            return this.allowed_guilds.has(invite.guild.id);
        } catch {
            return false;
        }
    }

    async member_is_proficient_or_higher(member: Discord.GuildMember | null) {
        if (!member) {
            return false;
        }
        const skill_roles = member.roles.cache.filter(role =>
            Object.values(this.wheatley.skill_roles).some(skill_role => role.id == skill_role.id),
        );
        if (skill_roles.size > 1) {
            const skill_role_ranks = Object.values(this.wheatley.skill_roles).map(role => role.id);
            const proficient_index = skill_role_ranks.indexOf(this.wheatley.skill_roles.proficient.id);
            assert(proficient_index !== -1);
            return skill_roles.some(role => skill_role_ranks.indexOf(role.id) >= proficient_index);
        }
        return false;
    }

    async handle_message(message: Discord.Message) {
        if (await this.wheatley.check_permissions(message.author, Discord.PermissionFlagsBits.ModerateMembers)) {
            return;
        }
        const match = match_invite(message.content);
        if (match && !(await this.is_allowed(match)) && !(await this.member_is_proficient_or_higher(message.member))) {
            const quote = await this.utilities.make_quote_embeds([message]);
            await message.delete();
            assert(!(message.channel instanceof Discord.PartialGroupDMChannel));
            await message.channel.send(`<@${message.author.id}> Please do not send invite links`);
            await this.staff_flag_log.send({
                content: `:warning: Invite link deleted`,
                ...quote,
            });
        }
    }

    override async on_message_create(message: Discord.Message) {
        await this.handle_message(message);
    }

    override async on_message_update(
        old_message: Discord.Message | Discord.PartialMessage,
        new_message: Discord.Message | Discord.PartialMessage,
    ) {
        await this.handle_message(await departialize(new_message));
    }
}
