import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import { ensure_index } from "../../../infra/database-interface.js";
import { role_map } from "../../../role-map.js";
import { wheatley_roles } from "../../wheatley/roles.js";
import SkillRoles, { SkillLevel } from "./skill-roles.js";
import { assert_type, unwrap } from "../../../utils/misc.js";

type voice_first_join_notice_entry = {
    guild: string;
    user: string;
    first_seen_at: Date;
    first_channel: string;
};

export default class VoiceFirstJoinNotice extends BotComponent {
    private roles = role_map(
        this.wheatley,
        wheatley_roles.voice,
        wheatley_roles.no_voice,
        wheatley_roles.server_booster,
    );
    private database = this.wheatley.database.create_proxy<{
        voice_first_join_notice: voice_first_join_notice_entry;
    }>();

    skill_roles_component!: SkillRoles;

    override async setup() {
        await ensure_index(
            this.wheatley,
            this.database.voice_first_join_notice,
            { guild: 1, user: 1 },
            { unique: true },
        );
        this.roles.resolve();
        this.skill_roles_component = assert_type(unwrap(this.wheatley.components.get("SkillRoles")), SkillRoles);
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (
            new_state.guild.id !== this.wheatley.guild.id ||
            old_state.channelId != null ||
            new_state.channelId == null ||
            new_state.channelId === this.wheatley.guild.afkChannelId ||
            !new_state.member ||
            new_state.member.user.bot
        ) {
            return;
        }
        const member = new_state.member;
        const res = await this.database.voice_first_join_notice.updateOne(
            { guild: new_state.guild.id, user: member.id },
            {
                $setOnInsert: {
                    guild: new_state.guild.id,
                    user: member.id,
                    first_seen_at: new Date(),
                    first_channel: new_state.channelId,
                },
            },
            { upsert: true },
        );
        if (res.upsertedCount === 0) {
            return;
        }
        if (
            member.roles.cache.has(this.roles.voice.id) ||
            member.roles.cache.has(this.roles.no_voice.id) ||
            member.roles.cache.has(this.roles.server_booster.id) ||
            (await this.wheatley.check_permissions(member, Discord.PermissionFlagsBits.BanMembers)) ||
            (await this.wheatley.check_permissions(member, Discord.PermissionFlagsBits.MuteMembers)) ||
            this.skill_roles_component.find_highest_skill_level(member) > SkillLevel.beginner
        ) {
            return;
        }
        const channel = new_state.channel;
        if (!channel) {
            return;
        }
        await channel.send({
            content:
                `<@${member.id}> ` +
                "new users are suppressed by default to protect our voice channels. " +
                "You will be able to speak when joining a channel with a voice moderator present. " +
                "Stick around and you will eventually be granted permanent voice access. " +
                "__Please do not ping voice moderators to be unsupressed or for the voice role.__",
            allowedMentions: { users: [member.id] },
        });
    }
}
