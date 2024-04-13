import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { critical_error, M } from "../utils/debugging-and-logging.js";
import { HOUR } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";

type permissions_entry = {
    allow?: bigint[];
    deny?: bigint[];
};

type permission_overwrites = Record<string, permissions_entry>;

type category_permission_entry = {
    category: Discord.CategoryChannel;
    permissions: permission_overwrites;
};

type channel_permission_entry = {
    channel: Discord.GuildChannel;
    permissions: permission_overwrites;
};

/**
 * Manage channel and category permissions
 */
export default class PermissionManager extends BotComponent {
    static override get is_freestanding() {
        return true;
    }

    category_permissions: Record<string, category_permission_entry> = {};
    channel_overrides: Record<string, channel_permission_entry> = {};

    constructor(wheatley: Wheatley) {
        super(wheatley);
    }

    setup_permissions_map() {
        const muted_permissions: permissions_entry = {
            deny: [
                Discord.PermissionsBitField.Flags.SendMessages,
                Discord.PermissionsBitField.Flags.SendMessagesInThreads,
                Discord.PermissionsBitField.Flags.CreatePublicThreads,
                Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                Discord.PermissionsBitField.Flags.AddReactions,
                Discord.PermissionsBitField.Flags.Speak,
                Discord.PermissionsBitField.Flags.SendTTSMessages,
                Discord.PermissionsBitField.Flags.UseApplicationCommands,
            ],
        };
        const default_permissions: permission_overwrites = {
            [this.wheatley.roles.muted.id]: muted_permissions,
            [this.wheatley.roles.no_reactions.id]: {
                deny: [Discord.PermissionsBitField.Flags.AddReactions],
            },
            [this.wheatley.roles.no_threads.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessagesInThreads,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                ],
            },
            [this.wheatley.roles.no_images.id]: {
                deny: [Discord.PermissionsBitField.Flags.EmbedLinks, Discord.PermissionsBitField.Flags.AttachFiles],
            },
            [this.wheatley.roles.moderators.id]: {
                allow: [Discord.PermissionsBitField.Flags.ManageThreads],
            },
        };

        this.add_entry(this.wheatley.categories.cpp_help, default_permissions);
        this.add_entry(this.wheatley.categories.c_help, default_permissions);
        this.add_entry(this.wheatley.categories.discussion, default_permissions);
        this.add_entry(this.wheatley.categories.specialized, default_permissions);
        this.add_entry(this.wheatley.categories.community, default_permissions);

        this.add_channel_overwrite(this.wheatley.channels.today_i_learned, {
            ...default_permissions,
            [this.wheatley.roles.no_til.id]: muted_permissions,
        });
    }

    add_entry(category: Discord.CategoryChannel, permissions: permission_overwrites) {
        this.category_permissions[category.id] = {
            category,
            permissions,
        };
    }

    add_channel_overwrite(channel: Discord.GuildChannel, permissions: permission_overwrites) {
        this.channel_overrides[channel.id] = {
            channel,
            permissions,
        };
    }

    async set_channel_permissions(channel: Discord.CategoryChildChannel, { category }: category_permission_entry) {
        if (channel.id in this.channel_overrides) {
            M.log(
                `Setting permissions for channel ${channel.id} ${channel.name} ` +
                    `with category ${category.id} ${category.name}`,
            );
            await category.permissionOverwrites.set(
                Object.entries(this.channel_overrides[channel.id].permissions).map(([id, permissions]) => ({
                    id,
                    ...permissions,
                })),
            );
        } else {
            M.log(`Syncing channel ${channel.id} ${channel.name} with category ${category.id} ${category.name}`);
            await channel.lockPermissions();
        }
    }

    async set_category_permissions({ category, permissions }: category_permission_entry) {
        M.log(`Setting permissions for category ${category.id} ${category.name}`);
        await category.permissionOverwrites.set(
            Object.entries(permissions).map(([id, permissions]) => ({ id, ...permissions })),
        );
        const channels = category.children.cache.map(channel => channel);
        for (const channel of channels) {
            await this.set_channel_permissions(channel, { category, permissions });
        }
    }

    async set_permissions() {
        for (const entry of Object.values(this.category_permissions)) {
            await this.set_category_permissions(entry);
        }
    }

    override async on_ready() {
        this.setup_permissions_map();
        this.set_permissions().catch(critical_error);
        setTimeout(() => {
            this.set_permissions().catch(critical_error);
        }, HOUR);
    }
}
