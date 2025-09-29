import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../utils/debugging-and-logging.js";
import { colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";
import { Wheatley } from "../wheatley.js";
import { EarlyReplyMode, TextBasedCommandBuilder } from "../command-abstractions/text-based-command-builder.js";
import { TextBasedCommand } from "../command-abstractions/text-based-command.js";
import { unwrap } from "../utils/misc.js";
import { ModalInteractionBuilder, BotModal } from "../command-abstractions/modal.js";

export default class Echo extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    private say_modal!: BotModal<[]>;

    override async setup(commands: CommandSetBuilder) {
        commands.add(
            new TextBasedCommandBuilder("echo", EarlyReplyMode.none)
                .set_description("Echo")
                .add_string_option({
                    title: "input",
                    description: "The input to echo back",
                    required: true,
                })
                .set_handler(this.echo.bind(this)),
        );
        commands.add(
            new TextBasedCommandBuilder("say", EarlyReplyMode.none)
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_description("Say as wheatley")
                .set_handler(this.say.bind(this)),
        );

        this.say_modal = commands.add(
            new ModalInteractionBuilder("say_modal")
                .set_title("Say as Wheatley")
                .add_paragraph_field("say_modal_message", "Message", {
                    placeholder: "Hello, World!",
                    required: true,
                })
                .set_permissions(Discord.PermissionFlagsBits.BanMembers)
                .set_handler(this.say_modal_submit.bind(this)),
        );
    }

    async echo(command: TextBasedCommand, input: string) {
        M.debug("Received echo command", input);
        await command.reply(input, true);
    }

    async say(command: TextBasedCommand) {
        M.debug("Received say command");
        if (!command.is_slash()) {
            await command.reply("Must be slash");
            return;
        }

        const modal = this.say_modal.create_modal();
        await command.get_interaction().showModal(modal);
    }

    async say_modal_submit(interaction: Discord.ModalSubmitInteraction) {
        const message = this.say_modal.get_field_value(interaction, "say_modal_message");
        await interaction.deferReply({ ephemeral: true });
        const channel = unwrap(interaction.channel);
        assert(channel.isTextBased() && !(channel instanceof Discord.PartialGroupDMChannel));
        await channel.send(message);
        await interaction.editReply({
            content: "Done",
            components: [],
        });
    }
}
