import * as Discord from "discord.js";
import { BotComponent } from "../bot-component.js";
import { M } from "../utils/debugging-and-logging.js";
import { unwrap } from "../utils/misc.js";
import Wiki from "./wiki.js";
import { embeds_match } from "../utils/discord.js";

type rules_state = {
    id: "rules";
    message_id: string | null;
};

export default class RulesMessage extends BotComponent {
    private database = this.wheatley.database.create_proxy<{
        component_state: rules_state;
    }>();

    private rules_channel!: Discord.TextChannel;
    private wiki!: Wiki;

    override async setup() {
        this.rules_channel = await this.utilities.get_channel(this.wheatley.channels.rules);
        this.wiki = unwrap(this.wheatley.components.get("Wiki")) as Wiki;
    }

    override async on_ready() {
        await this.update_or_create_rules_message();
    }

    async update_or_create_rules_message() {
        const state = await this.database.component_state.findOne({ id: "rules" });
        if (state?.message_id) {
            try {
                const existing_message = await this.rules_channel.messages.fetch(state.message_id);
                await this.maybe_update_rules_message(existing_message);
                return;
            } catch (e) {
                if (e instanceof Discord.DiscordAPIError && e.code === 10008) {
                    // Message not found, create new one
                    // falltrough
                } else {
                    throw e;
                }
            }
        }
        await this.create_rules_message();
    }

    get_rules() {
        const rules_article = unwrap(this.wiki.articles["rules.md"]);
        const embed = this.wiki.build_article_embed(rules_article);
        return embed;
    }

    async create_rules_message() {
        M.log("Creating rules message");
        const message = await this.rules_channel.send({ embeds: [this.get_rules()] });
        await this.database.component_state.findOneAndUpdate(
            { id: "rules" },
            { $set: { message_id: message.id } },
            { upsert: true },
        );
    }

    async maybe_update_rules_message(existing_message: Discord.Message) {
        const current_embed = this.get_rules();
        if (existing_message.embeds.length > 0 && embeds_match(existing_message.embeds[0], current_embed)) {
            M.log("Rules message content is up to date");
        } else {
            M.log("Rules message content has changed, updating");
            await existing_message.edit({ embeds: [current_embed] });
        }
    }
}
