import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { M } from "../../../utils/debugging-and-logging.js";
import { BotComponent } from "../../../bot-component.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";
import { Wheatley } from "../../../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../../../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../../../command-abstractions/text-based-command.js";
import { markdown_node, MarkdownParser } from "dismark";
import { Synopsinator } from "../../../utils/synopsis.js";

/**
 * Provides TCCPP-specific utilities for renaming channels etc.
 */
export default class UtilityTools extends BotComponent {
    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("count", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Count")
                .add_number_option({
                    title: "count",
                    description: "count",
                    required: true,
                })
                .set_handler(this.count.bind(this)),
        );
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots
        if (message.author.bot) {
            return;
        }
        if (await this.wheatley.fetch_member_if_permitted(message.author, Discord.PermissionFlagsBits.ManageChannels)) {
            if (message.content == "!channel-rename") {
                M.log("got !channel-rename");
                assert(!(message.channel instanceof Discord.PartialGroupDMChannel));
                const m = await message.channel.send("working...");
                const channels = await this.wheatley.guild.channels.fetch();
                for (const [_, channel] of channels) {
                    assert(channel);
                    const r = channel.name.replace(/_/g, "-");
                    M.log("Renaming", channel.name, r);
                    await channel.setName(r);
                }
                M.log("Done");
                await m.edit(":+1:");
            } else if (message.content == "!sync-archive-permissions") {
                M.log("got !sync-archive-permissions");
                const archive = await this.wheatley.guild.channels.fetch("910306041969913938");
                assert(archive instanceof Discord.CategoryChannel);
                for (const [_, channel] of archive.children.cache) {
                    await channel.lockPermissions();
                }
                await message.reply("Done");
            } else if (message.content == "!prefix-archive-channels") {
                M.log("got !prefix-archive-channels");
                for (const id of [
                    "910306041969913938",
                    "455278783352537099",
                    "429594248099135488",
                    "910308747929321492",
                ]) {
                    const archive = await this.wheatley.guild.channels.fetch(id);
                    assert(archive instanceof Discord.CategoryChannel);
                    for (const [_, channel] of archive.children.cache) {
                        if (!channel.name.startsWith("archived-")) {
                            await channel.setName(`archived-${channel.name}`);
                        }
                    }
                }
                await message.reply("Done");
            } else if (message.content == "!xxx") {
                const logs = await this.wheatley.guild.fetchAuditLogs({
                    limit: 10,
                    type: Discord.AuditLogEvent.MessageDelete,
                });
                M.log(logs);
                await message.reply("Done");
            } else if (message.content.startsWith("!md-echo")) {
                const ast = new MarkdownParser().parse(message.content);
                const get_first_code_block = (node: markdown_node): string | null => {
                    switch (node.type) {
                        case "doc": {
                            const parts = node.content.map(node => get_first_code_block(node)).filter(result => result);
                            return parts.length > 0 ? parts[0] : null;
                        }
                        case "list": {
                            const items = node.items.map(node => get_first_code_block(node)).filter(result => result);
                            return items.length > 0 ? items[0] : null;
                        }
                        case "italics":
                        case "bold":
                        case "underline":
                        case "strikethrough":
                        case "spoiler":
                        case "header":
                        case "subtext":
                        case "masked_link":
                        case "blockquote":
                            return get_first_code_block(node.content);
                        case "plain":
                        case "inline_code":
                            return null;
                        case "code_block":
                            return node.content;
                        default:
                            throw new Error(`Unknown ast node ${(node as markdown_node).type}`);
                    }
                };
                const requested_markdown = get_first_code_block(ast);
                await message.reply(requested_markdown ?? "Error");
            } else if (message.content.startsWith("!synopsis")) {
                const content = message.content.substring("!synopsis".length).trim();
                await message.reply({
                    embeds: [new Discord.EmbedBuilder().setDescription(Synopsinator.make_synopsis(content))],
                });
            }
        }
    }

    async count(command: TextBasedCommand, count: number) {
        await command.reply("Sending...");
        const channel = await command.get_channel();
        assert(!(channel instanceof Discord.PartialGroupDMChannel));
        for (let i = 0; i < count; i++) {
            await channel.send(i.toString());
        }
    }
}
