import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { get_tag } from "../../../utils/discord.js";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { colors, MINUTE } from "../../../common.js";

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder().setColor(color).setDescription(msg);
    if (title) {
        embed.setTitle(title);
    }
    return embed;
}

export default class AntiForumPostDelete extends BotComponent {
    override async on_message_delete(message: Discord.Message | Discord.PartialMessage) {
        if (message.guildId !== this.wheatley.guild.id) {
            return;
        }
        if (message.channel.id == message.id) {
            assert(message.channel.isThread());
            const thread = message.channel;
            if (
                this.wheatley.is_forum_help_thread(thread) &&
                (Date.now() - thread.createdTimestamp! > 2 * MINUTE || thread.messageCount! > 0)
            ) {
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const open_tag = get_tag(forum, "Open").id;
                const solved_tag = get_tag(forum, "Solved").id;
                const stale_tag = get_tag(forum, "Stale").id;
                M.log(`Firing AntiForumPostDelete on ${thread.url}`);
                await thread.send({
                    content: `<@${message.author?.id}>`,
                    embeds: [
                        create_embed(
                            "Please Do Not Delete Posts!",
                            colors.red,
                            "Please don't delete forum posts. They can be helpful to refer to later and other members" +
                                " can learn from them. In the future you can use `!solved` to close a post and mark a" +
                                " post as solved.",
                        ),
                    ],
                });
                if (!thread.appliedTags.includes(stale_tag)) {
                    await thread.setAppliedTags(
                        [stale_tag].concat(thread.appliedTags.filter(t => ![open_tag, solved_tag].includes(t))),
                    );
                }
                await thread.setArchived(true);
            } else {
                await thread.delete();
            }
        }
    }
}
