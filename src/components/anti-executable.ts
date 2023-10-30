import * as Discord from "discord.js";
import * as https from "https";

import { strict as assert } from "assert";

import { M, critical_error } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { build_description, capitalize } from "../utils/strings.js";
import { make_quote_embeds } from "./quote.js";

/**
 * Prevent executables and check for viruses
 */
export default class AntiExecutable extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    // Elf:  0x7F 0x45 0x4c 0x46 at offset 0
    // Mach: 0xfe 0xed 0xfa 0xce offset 0
    //       0xce 0xfa 0xed 0xfe
    //       0xfe 0xed 0xfa 0xcf
    //       0xcf 0xfa 0xed 0xfe
    // PE:   4D 5A offset 0
    //   and 50 45 00 00 at variable offset
    static readonly executable_magic = [
        Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // elf
        Buffer.from([0xfe, 0xed, 0xfa, 0xce]), // mach-o 32-bit big endian
        Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // mach-o 32-bit little endian
        Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), // mach-o 64-bit big endian
        Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // mach-o 64-bit little endian
        Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // mach-o universal
        Buffer.from([0xbe, 0xba, 0xfe, 0xca]), // mach-o universal swapped
        Buffer.from([0x4d, 0x5a]), // DOS MZ / PE
    ];
    looks_like_executable(buffer: Buffer) {
        for (const magic of AntiExecutable.executable_magic) {
            if (buffer.subarray(0, magic.length).equals(magic)) {
                return true;
            }
        }
        return false;
    }

    fetch(url: string, limit?: number) {
        return new Promise<Buffer>((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            https
                .get(url, res => {
                    if (res.statusCode !== 200) {
                        throw new Error(`Request failed status code: ${res.statusCode}`);
                    }
                    res.on("data", chunk => {
                        buffer = Buffer.concat([buffer, chunk]);
                        if (limit !== undefined && buffer.length >= limit) {
                            res.destroy();
                            resolve(buffer);
                        }
                    });
                    res.on("end", () => {
                        resolve(buffer);
                    });
                    res.on("error", reject);
                })
                .on("error", reject)
                .end();
        });
    }

    async virustotal_scan(file_buffer: Buffer, flag_messsage: Discord.Message) {
        const res = await this.wheatley.virustotal.upload(file_buffer);
        const bad_count = res.stats.suspicious + res.stats.malicious;
        await flag_messsage.reply({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(bad_count > 0 ? colors.red : colors.wheatley)
                    .setTitle("VirusTotal result")
                    .setURL(res.url)
                    .setDescription(
                        build_description(
                            ...Object.entries(res.stats).map(([name, count]) => `${capitalize(name)}: ${count}`),
                        ),
                    ),
            ],
        });
    }

    async handle_executables(message: Discord.Message, executables: Discord.Attachment[]) {
        const quote = await make_quote_embeds([message], null, this.wheatley, true);
        await message.delete();
        await message.channel.send(`<@${message.author.id}> Please do not send executable files`);
        const flag_messsage = await this.wheatley.channels.staff_flag_log.send({
            content: `:warning: Executable file detected`,
            ...quote,
        });
        await Promise.all(
            executables.map(async executable => {
                // download
                let file_buffer: Buffer;
                try {
                    file_buffer = await this.fetch(executable.url);
                } catch (e) {
                    critical_error(e);
                    return;
                }
                // virustotal
                if (!this.wheatley.freestanding) {
                    await this.virustotal_scan(file_buffer, flag_messsage);
                }
            }),
        );
    }

    override async on_message_create(message: Discord.Message) {
        if (message.author.bot) {
            return;
        }
        if (message.attachments.size > 0) {
            const executables: Discord.Attachment[] = [];
            for (const [_, attachment] of message.attachments) {
                const res = await this.fetch(attachment.url, 64);
                if (this.looks_like_executable(res)) {
                    executables.push(attachment);
                }
            }
            if (executables.length > 0) {
                await this.handle_executables(message, executables);
            }
        }
    }
}
