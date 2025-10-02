import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { M } from "../utils/debugging-and-logging.js";
import { BotComponent } from "../bot-component.js";
import { departialize } from "../utils/discord.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";

const INVITE_RE =
    /(?:(?:discord(?:app)?|disboard)\.(?:gg|(?:com|org|me)\/(?:invite|server\/join))|(?<!\w)\.gg)\/(\S+)/i;

export function match_invite(content: string): string | null {
    const match = content.match(INVITE_RE);
    return match ? match[1] : null;
}

type allowed_invite_entry = {
    code: string;
    guild_id: string;
    guild_name: string;
    guild_icon: string;
};

export default class AntiInviteLinks extends BotComponent {
    private allowed_invites = new Set<string>();

    private staff_flag_log!: Discord.TextChannel;

    private database = this.wheatley.database.create_proxy<{
        allowed_invites: allowed_invite_entry;
    }>();

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);

        commands.add(
            new TextBasedCommandBuilder("allowed-invites", EarlyReplyMode.ephemeral)
                .set_permissions(Discord.PermissionFlagsBits.ModerateMembers)
                .set_description("manage allowed server invites")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.Administrator)
                        .set_description("add allowed invite code")
                        .add_string_option({
                            title: "code",
                            description: "code to add",
                            required: true,
                        })
                        .set_handler(this.handle_add.bind(this)),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove", EarlyReplyMode.ephemeral)
                        .set_permissions(Discord.PermissionFlagsBits.Administrator)
                        .set_description("remove allowed invite code")
                        .add_string_option({
                            title: "code",
                            description: "code to remove",
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
    }

    override async on_ready() {
        this.allowed_invites = new Set((await this.database.allowed_invites.find().toArray()).map(e => e.code));
    }

    private static build_guild_embed(entry: allowed_invite_entry) {
        return new Discord.EmbedBuilder()
            .setAuthor({
                name: entry.guild_name,
                url: `https://discord.gg/${entry.code}`,
                iconURL: `https://cdn.discordapp.com/icons/${entry.guild_id}/${entry.guild_icon}.png`,
            })
            .setFooter({ text: entry.code });
    }

    private async handle_add(command: TextBasedCommand, code: string) {
        if (this.allowed_invites.has(code)) {
            await command.react("🤷", true);
            return;
        }
        M.log("Adding ", code, " to allowed invites");
        const server_info = await (await fetch(`https://discord.com/api/v10/invites/${code}`)).json();
        if (server_info.code != code) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} not a valid invite`, true);
            return;
        }
        if (server_info.expires != null) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} not a permanent invite`, true);
            return;
        }
        const res = await this.database.allowed_invites.findOneAndUpdate(
            { code: code },
            {
                $set: {
                    code: code,
                    guild_id: server_info.guild_id,
                    guild_name: server_info.guild.name,
                    guild_icon: server_info.guild.icon,
                },
            },
            { upsert: true, returnDocument: "after" },
        );
        if (res == null) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} database update failed`, true);
            return;
        }
        this.allowed_invites.add(code);
        await command.replyOrFollowUp({
            embeds: [AntiInviteLinks.build_guild_embed(res)],
        });
    }

    private async handle_remove(command: TextBasedCommand, code: string) {
        if (!this.allowed_invites.has(code)) {
            await command.react("🤷", true);
            return;
        }
        M.log("Removing ", code, " from allowed invites");
        const res = await this.database.allowed_invites.findOneAndDelete({ code: code });
        if (res == null) {
            await command.replyOrFollowUp(`${this.wheatley.emoji.error} database update failed`, true);
            return;
        }
        this.allowed_invites.delete(code);
        await command.react(this.wheatley.emoji.success, true);
    }

    private async handle_list(command: TextBasedCommand) {
        const codes = await this.database.allowed_invites.find().toArray();
        await command.reply({
            embeds: codes.map(AntiInviteLinks.build_guild_embed),
        });
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
        if (match && !this.allowed_invites.has(match) && !(await this.member_is_proficient_or_higher(message.member))) {
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
