import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { SECOND } from "../common.js";
import { BotComponent } from "../bot-component.js";

export default class AntiAFK extends BotComponent {
    private countdown = new Map<string, NodeJS.Timeout>();

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if ((!new_state.selfDeaf || new_state.channel != old_state.channel) && this.countdown.has(new_state.id)) {
            clearTimeout(this.countdown.get(new_state.id));
            this.countdown.delete(new_state.id);
        }
        if (
            new_state.channel != null &&
            new_state.channelId != this.wheatley.guild.afkChannelId &&
            new_state.selfDeaf
        ) {
            assert(new_state.member);
            const member = new_state.member;
            const timeout = setTimeout(
                () => {
                    member.voice
                        .setChannel(this.wheatley.guild.afkChannel)
                        .catch(this.wheatley.critical_error.bind(this.wheatley));
                    this.countdown.delete(new_state.id);
                },
                (this.wheatley.guild.afkTimeout + 30) * SECOND,
            );
            this.countdown.set(new_state.id, timeout);
        }
    }
}
