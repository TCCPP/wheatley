import * as Discord from "discord.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { ReplyTracker } from "../../../utils/reply-tracker.js";

const failed_everyone_re = /(?:@everyone|@here)\b/g;

export default class AntiEveryone extends BotComponent {
    private reply_tracker = new ReplyTracker(this.wheatley, { delete_on_trigger_delete: true });

    override async on_message_create(message: Discord.Message): Promise<void> {
        if (
            // self
            message.author.id == this.wheatley.user.id ||
            // bot
            message.author.bot ||
            // mod
            (await this.wheatley.check_permissions(message.author, Discord.PermissionFlagsBits.MentionEveryone)) ||
            // outside of TCCPP (like DMs)
            message.guildId != this.wheatley.guild.id
        ) {
            return;
        }
        if (message.content.match(failed_everyone_re) != null) {
            M.log("AntiEveryone: Someone tried to mention here or everyone");
            // NOTE: .toLocaleString("en-US") formats this number with commas.
            const member_count = this.wheatley.guild.members.cache.size.toLocaleString("en-US");
            try {
                const reply = await message.reply({
                    content: `Did you really just try to ping ${member_count} people?`,
                });
                this.reply_tracker.track(message.author, reply, message.id);
            } catch (e) {
                if (e instanceof Discord.DiscordAPIError && e.code === 50035) {
                    // If the original message was deleted before we could reply, ignore the error
                } else {
                    this.wheatley.critical_error(e);
                }
            }
        }
    }
}
