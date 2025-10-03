import * as Discord from "discord.js";
import { BotButton, ButtonInteractionBuilder } from "../command-abstractions/button.js";
import { KeyedMutexSet } from "./containers.js";
import { CommandSetBuilder } from "../command-abstractions/command-set-builder.js";

export interface Staff_notification_buttons {
    handling: BotButton<[]>;
    resolved: BotButton<[]>;
    invalid: BotButton<[]>;
    nvm: BotButton<[]>;
}

export class Staff_notification_button_helper {
    readonly mutex = new KeyedMutexSet<string>();

    register_buttons(
        commands: CommandSetBuilder,
        prefix: string,
        handlers: {
            handling: (interaction: Discord.ButtonInteraction) => Promise<void>;
            resolved: (interaction: Discord.ButtonInteraction) => Promise<void>;
            invalid: (interaction: Discord.ButtonInteraction) => Promise<void>;
            nvm: (interaction: Discord.ButtonInteraction) => Promise<void>;
        },
    ): Staff_notification_buttons {
        return {
            handling: commands.add(new ButtonInteractionBuilder(`${prefix}-handling`).set_handler(handlers.handling)),
            resolved: commands.add(new ButtonInteractionBuilder(`${prefix}-resolved`).set_handler(handlers.resolved)),
            invalid: commands.add(new ButtonInteractionBuilder(`${prefix}-invalid`).set_handler(handlers.invalid)),
            nvm: commands.add(new ButtonInteractionBuilder(`${prefix}-nvm`).set_handler(handlers.nvm)),
        };
    }

    create_handling_button(button: BotButton<[]>, label?: string) {
        return button
            .create_button()
            .setLabel(label ?? "I'm looking into this")
            .setStyle(Discord.ButtonStyle.Secondary);
    }

    create_resolved_button(button: BotButton<[]>) {
        return button.create_button().setLabel("Resolved").setStyle(Discord.ButtonStyle.Success);
    }

    create_invalid_button(button: BotButton<[]>) {
        return button.create_button().setLabel("Invalid").setStyle(Discord.ButtonStyle.Danger);
    }

    create_nvm_button(button: BotButton<[]>) {
        return button
            .create_button()
            .setLabel("I'm no longer looking into this")
            .setStyle(Discord.ButtonStyle.Secondary);
    }

    create_standard_action_row(buttons: Staff_notification_buttons) {
        return new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.create_handling_button(buttons.handling),
            this.create_resolved_button(buttons.resolved),
            this.create_invalid_button(buttons.invalid),
        );
    }

    create_handling_action_row(buttons: Staff_notification_buttons, handler_name: string) {
        return new Discord.ActionRowBuilder<Discord.MessageActionRowComponentBuilder>().addComponents(
            this.create_handling_button(buttons.handling, `Being handled by ${handler_name}`),
            this.create_nvm_button(buttons.nvm),
            this.create_resolved_button(buttons.resolved),
            this.create_invalid_button(buttons.invalid),
        );
    }

    async locked_interaction(interaction: Discord.ButtonInteraction, callback: (m: Discord.Message) => Promise<void>) {
        await interaction.deferReply({ ephemeral: true });
        const message = interaction.message;
        if (!this.mutex.try_lock(message.id)) {
            await interaction.reply({
                content: `Race condition with button presses`,
                ephemeral: true,
            });
            return;
        }
        try {
            await interaction.editReply({
                content: `Received button press, updating message...`,
            });
            await callback(message);
            await interaction.editReply({
                content: `Done`,
            });
        } finally {
            this.mutex.unlock(message.id);
        }
    }
}
