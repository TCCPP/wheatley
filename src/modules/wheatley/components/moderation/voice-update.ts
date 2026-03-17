import * as Discord from "discord.js";

import { BotComponent } from "../../../../bot-component.js";
import { CommandSetBuilder } from "../../../../command-abstractions/command-set-builder.js";
import {
    EarlyReplyMode,
    TextBasedCommandBuilder,
} from "../../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../../command-abstractions/text-based-command.js";
import { wheatley_roles } from "../../roles.js";
import { create_error_reply } from "../../../../wheatley.js";
import {
    perform_voice_update,
    select_everyone,
    exclude_bots,
    select_without_role,
    type VoiceUpdateContext,
} from "../../../../utils/voice-update.js";

export default class VoiceUpdate extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("voice", EarlyReplyMode.ephemeral)
                .set_description("Voice moderation")
                .set_permissions(Discord.PermissionFlagsBits.MuteMembers)
                .add_subcommand(
                    new TextBasedCommandBuilder("update", EarlyReplyMode.ephemeral)
                        .set_description("Force-refresh voice permissions in your current channel")
                        .add_boolean_option({
                            title: "all",
                            description:
                                "Refresh everyone (required on non-TCCPP). Omit on TCCPP for affected users only.",
                            required: false,
                        })
                        .set_handler(this.handle_update.bind(this)),
                ),
        );
    }

    private async handle_update(command: TextBasedCommand, all: boolean | null) {
        const member = await command.get_member();
        if (!member.permissions.has(Discord.PermissionFlagsBits.MoveMembers)) {
            await command.reply(create_error_reply("You need the Move Members permission to use this command."));
            return;
        }

        const channel = member.voice.channel;
        if (!channel?.isVoiceBased()) {
            await command.reply(create_error_reply("You must be in a voice channel to use this command."));
            return;
        }

        if (!all && !this.wheatley.is_tccpp_like()) {
            await command.reply(
                create_error_reply(
                    "Specify `all: true` to refresh everyone. (The affected-user mode is only available on TCCPP.)",
                ),
            );
            return;
        }

        let selector = exclude_bots(select_everyone);
        if (!all) {
            let voice_role: Discord.Role;
            try {
                voice_role = this.utilities.resolve_role(wheatley_roles.voice);
            } catch {
                await command.reply(
                    create_error_reply(
                        "Could not resolve the `voice` role needed for affected-user refresh. " +
                            "Create that role in the dev guild or run with `all: true`.",
                    ),
                );
                return;
            }
            selector = exclude_bots(select_without_role(voice_role.id));
        }

        const context: VoiceUpdateContext = {
            guild: this.wheatley.guild,
            caller: member,
            channel,
            wheatley: this.wheatley,
        };
        const result = await perform_voice_update(context, selector);
        if (result.afk_missing) {
            await command.reply(
                create_error_reply("No AFK channel is configured for this guild, so voice refresh cannot run."),
            );
            return;
        }

        const scope = all ? "" : " affected";
        const skipped_suffix = result.skipped > 0 ? ` (${result.skipped} skipped)` : "";
        await command.reply({
            content:
                `Refreshed voice permissions for ${result.succeeded}${scope} member(s) in ${channel.name}.` +
                skipped_suffix +
                (result.failed > 0 ? ` (${result.failed} failed)` : ""),
            should_text_reply: true,
        });
    }
}
