import * as Discord from "discord.js";
import { strict as assert } from "assert";

import { BotComponent } from "../../../../bot-component.js";
import { DAY, HOUR, MINUTE } from "../../../../common.js";
import { SelfClearingSet } from "../../../../utils/containers.js";
import { M } from "../../../../utils/debugging-and-logging.js";
import { markdown_node, MarkdownParser } from "dismark";

const STD_REGEX = /\bstd::/gi;
const POINTER_RE = /[\w>)]\*/gi;
const NEW_DELETE_RE = /\b(?:new|delete)\b/gi;

const ENABLED = false;

/**
 * 2025 April Fool's
 */
export default class SafeCpp extends BotComponent {
    // set of channel ids
    ratelimit = new SelfClearingSet<string>(10 * MINUTE, 10 * MINUTE);

    override async on_message_create(message: Discord.Message) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!ENABLED) {
            return;
        }
        if (message.author.bot || this.ratelimit.has(message.channelId)) {
            return;
        }

        const ast = new MarkdownParser().parse(message.content);
        const check_code = async (node: markdown_node): Promise<boolean> => {
            switch (node.type) {
                case "doc":
                    for (const child of node.content) {
                        if (await check_code(child)) {
                            return true;
                        }
                    }
                    break;
                case "list":
                    for (const child of node.items) {
                        if (await check_code(child)) {
                            return true;
                        }
                    }
                    break;
                case "italics":
                case "bold":
                case "underline":
                case "strikethrough":
                case "spoiler":
                case "header":
                case "subtext":
                case "masked_link":
                case "blockquote":
                    await check_code(node.content);
                    break;
                case "plain":
                    break;
                case "inline_code":
                case "code_block":
                    if (STD_REGEX.test(node.content)) {
                        this.ratelimit.insert(message.channelId);
                        M.log("firing std2:: auto-reply");
                        await message.reply(
                            ":information: Remember to use `std2::` for the Safe C++ Standard Library:tm:",
                        );
                        return true;
                    } else if (POINTER_RE.test(node.content)) {
                        this.ratelimit.insert(message.channelId);
                        M.log("firing pointer auto-reply");
                        await message.reply(
                            ":warning: **WARNING**: It looks like you used a *raw pointer*! " +
                                "This is not idiomadic Safe C++ and it has been reported to The Committee!",
                        );
                        return true;
                    } else if (NEW_DELETE_RE.test(node.content)) {
                        this.ratelimit.insert(message.channelId);
                        M.log("firing new/delete auto-reply");
                        await message.reply(
                            ":warning: **WARNING**: It looks like you used `new` or `delete` directly! " +
                                "This is not idiomadic Safe C++ and it has been reported to The Committee!",
                        );
                        return true;
                    } else if (Math.random() < 1 / 1000) {
                        this.ratelimit.insert(message.channelId);
                        M.log("firing lifetime annotation random message");
                        await message.reply(
                            ":information: Remember to use lifetime annotations in your code to get " +
                                ":star: Memory :star: Safety :star: ",
                        );
                        return true;
                    }
                    break;
                default:
                    throw new Error(`Unknown ast node ${(node as markdown_node).type}`);
            }
            return false;
        };
        await check_code(ast);
    }
}
