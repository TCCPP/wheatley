import { strict as assert } from "assert";
import * as Discord from "discord.js";

import { BotComponent } from "../../../bot-component.js";
import SkillRoles, { SkillLevel } from "./skill-roles.js";

type voice_first_join_notice_entry = {
    guild: string;
    user: string;
    first_seen_at: Date;
    first_channel: string;
};

export default class VoiceFirstJoinNotice extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        voice_first_join_notice: voice_first_join_notice_entry;
    }>();

    override async setup() {
        await this.database.voice_first_join_notice.createIndex({ guild: 1, user: 1 }, { unique: true });
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (old_state.channelId != null || new_state.channelId == null) {
            return;
        }

        if (new_state.guild.id !== this.wheatley.guild.id) {
            return;
        }

        const member = new_state.member;
        if (!member || member.user.bot) {
            return;
        }

        if (new_state.channelId === this.wheatley.guild.afkChannelId) {
            return;
        }

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

        if (member.roles.cache.has(this.wheatley.roles.voice.id)) {
            return;
        }

        if (member.roles.cache.has(this.wheatley.roles.no_voice.id)) {
            return;
        }

        if (member.roles.cache.has(this.wheatley.roles.server_booster.id)) {
            return;
        }

        const skill_roles_component = this.wheatley.components.get("SkillRoles");
        assert(skill_roles_component && skill_roles_component instanceof SkillRoles, "SkillRoles component missing");
        if (skill_roles_component.find_highest_skill_level(member) > SkillLevel.beginner) {
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
