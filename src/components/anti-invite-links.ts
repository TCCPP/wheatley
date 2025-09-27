import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { BotComponent } from "../bot-component.js";
import { departialize } from "../utils/discord.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";

const INVITE_RE =
    /(?:(?:discord(?:app)?|disboard)\.(?:gg|(?:com|org|me)\/(?:invite|server\/join))|(?<!\w)\.gg)\/(\S+)/i;

const whitelist = [
    "tccpp",
    "python",
    "csharp",
    "bVTPVpYVcv", // cuda
    "Eb7P3wH", // graphics
];

export function match_invite(content: string): string | null {
    const match = content.match(INVITE_RE);
    return match ? match[1] : null;
}

export default class AntiInviteLinks extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private staff_flag_log!: Discord.TextChannel;

    override async setup(commands: CommandSetBuilder) {
        this.staff_flag_log = await this.utilities.get_channel(this.wheatley.channels.staff_flag_log);
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
        if (await this.wheatley.fetch_member_if_permitted(message.author, Discord.PermissionFlagsBits.Administrator)) {
            return;
        }
        const match = match_invite(message.content);
        if (match && !whitelist.includes(match) && !(await this.member_is_proficient_or_higher(message.member))) {
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
