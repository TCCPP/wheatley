import { strict as assert } from "assert";

import * as Discord from "discord.js";

import { get_tag, M } from "../utils";
import { BotComponent } from "../bot_component";
import { colors, is_forum_help_thread } from "../common";

function create_embed(title: string | undefined, color: number, msg: string) {
    const embed = new Discord.EmbedBuilder()
        .setColor(color)
        .setDescription(msg);
    if(title) {
        embed.setTitle(title);
    }
    return embed;
}

export class AntiForumPostDelete extends BotComponent {
    override async on_message_delete(message: Discord.Message<boolean> | Discord.PartialMessage) {
        if(message.channel.id == message.id) {
            assert(message.channel.isThread());
            const thread = message.channel;
            if(is_forum_help_thread(thread)) {
                const forum = thread.parent;
                assert(forum instanceof Discord.ForumChannel);
                const open_tag = get_tag(forum, "Open").id;
                const solved_tag = get_tag(forum, "Solved").id;
                M.log(`Firing AntiForumPostDelete on ${thread.url}`);
                await thread.send({
                    content: `<@${message.author?.id}>`,
                    embeds: [
                        create_embed(
                            "Please Do Not Delete Posts!",
                            colors.red,
                            "Please don't delete forum posts. They can be helpful to refer to later and other members"
                            + " can learn from them. You can use `!solved` to close a post and mark it as solved."
                        )
                    ]
                });
                if(!thread.appliedTags.includes(solved_tag)) {
                    await thread.setAppliedTags([solved_tag].concat(thread.appliedTags.filter(t => t != open_tag)));
                }
            }
        }
    }
}
