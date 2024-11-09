import * as Discord from "discord.js";
import * as mongo from "mongodb";

import { strict as assert } from "assert";

import { unwrap } from "../../utils/misc.js";
import { M } from "../../utils/debugging-and-logging.js";
import { Wheatley } from "../../wheatley.js";
import { ModerationComponent, ParseError, duration_regex, parse_nullable_duration } from "./moderation-common.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../command-abstractions/text-based-command.js";
import { DAY } from "../../common.js";
import { moderation_entry, basic_moderation_with_user } from "../../infra/schemata/moderation.js";

export default class Timeout extends ModerationComponent {
    get type() {
        return "timeout" as const;
    }

    get past_participle() {
        return "timed out";
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);

        this.add_command(
            new TextBasedCommandBuilder("timeout", EarlyReplyMode.visible)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Timeout add / remove")
                .add_subcommand(
                    new TextBasedCommandBuilder("add", EarlyReplyMode.visible)
                        .set_description("Timeout user")
                        .add_user_option({
                            title: "user",
                            description: "User to timeout (max 28 days)",
                            required: true,
                        })
                        .add_string_option({
                            title: "duration",
                            description: "Duration",
                            regex: duration_regex,
                            required: false,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(
                            async (
                                command: TextBasedCommand,
                                user: Discord.User,
                                duration_string: string | null,
                                reason: string | null,
                            ) => {
                                let duration;
                                try {
                                    duration = parse_nullable_duration(duration_string);
                                } catch (e) {
                                    if (e instanceof ParseError) {
                                        await this.reply_with_error(command, e.message);
                                        return;
                                    }
                                    throw e;
                                }
                                if (duration == null || duration > 28 * DAY) {
                                    await this.reply_with_error(command, "Maximum allowable duration is 28 days");
                                    return;
                                }
                                return await this.moderation_issue_handler(command, user, duration_string, reason, {
                                    type: this.type,
                                });
                            },
                        ),
                )
                .add_subcommand(
                    new TextBasedCommandBuilder("remove", EarlyReplyMode.visible)
                        .set_description("Timeout remove user")
                        .add_user_option({
                            title: "user",
                            description: "User to remove from timeout",
                            required: true,
                        })
                        .add_string_option({
                            title: "reason",
                            description: "Reason",
                            required: false,
                        })
                        .set_handler(this.moderation_revoke_handler.bind(this)),
                ),
        );
    }

    async apply_moderation(entry: moderation_entry) {
        M.info(`Applying timeout to ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        const member = await this.wheatley.TCCPP.members.fetch(entry.user);
        await member.timeout(unwrap(entry.duration), entry.reason ?? "No reason provided");
    }

    async remove_moderation(entry: mongo.WithId<moderation_entry>) {
        M.info(`Removing timeout from ${entry.user_name}`);
        if (this.dummy_rounds) {
            return;
        }
        try {
            const member = await this.wheatley.TCCPP.members.fetch(entry.user);
            await member.timeout(null);
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 10007) {
                // Unknown member
                // For now can't really do anything....
            } else {
                throw e;
            }
        }
    }

    async is_moderation_applied(moderation: basic_moderation_with_user) {
        assert(moderation.type == this.type);
        try {
            const member = await this.wheatley.TCCPP.members.fetch(moderation.user);
            return member.communicationDisabledUntil !== null;
        } catch (e) {
            if (e instanceof Discord.DiscordAPIError && e.code === 10007) {
                // Unknown member
                // There's no way to check if a timeout is applied to a user outside the guild, just presume it is...
                return true;
            } else {
                throw e;
            }
        }
    }
}
