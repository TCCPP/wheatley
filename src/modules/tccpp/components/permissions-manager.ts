import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { HOUR } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";

const categories_map = {
    staff_logs: "1135927261472755712",
    staff: "873125551064363028",
    meta: "360691699288113163",
    tutoring: "923430684041818153",
    cpp_help: "897465499535949874",
    c_help: "931970218442493992",
    discussion: "855220194887335977",
    specialized: "360691955031867392",
    community: "1131921460034801747",
    off_topic: "360691500985745409",
    misc: "506274316623544320",
    bot_dev: "1166516815472640050",
    voice: "360692425242705921",
    archive: "910306041969913938",
    private_archive: "455278783352537099",
    challenges_archive: "429594248099135488",
    meta_archive: "910308747929321492",
};

type permissions_entry = {
    allow?: bigint[];
    deny?: bigint[];
};

type permission_overwrites = Record<string, permissions_entry>;

const SET_VOICE_STATUS_PERMISSION_BIT = 1n << 48n; // TODO: Replace once discord.js supports this in PermissionsBitField

export default class PermissionManager extends BotComponent {
    category_permissions: Record<string, permission_overwrites> = {};
    channel_overrides: Record<string, permission_overwrites> = {};

    setup_permissions_map() {
        // permission sets
        const write_permissions = [
            Discord.PermissionsBitField.Flags.SendMessages,
            Discord.PermissionsBitField.Flags.SendMessagesInThreads,
            Discord.PermissionsBitField.Flags.CreatePublicThreads,
            Discord.PermissionsBitField.Flags.CreatePrivateThreads,
            Discord.PermissionsBitField.Flags.AddReactions,
            Discord.PermissionsBitField.Flags.Speak,
            Discord.PermissionsBitField.Flags.SendTTSMessages,
            Discord.PermissionsBitField.Flags.UseApplicationCommands,
        ];
        const muted_permissions: permissions_entry = {
            deny: write_permissions,
        };
        const no_interaction_at_all: permissions_entry = {
            deny: [
                ...write_permissions,
                Discord.PermissionsBitField.Flags.Connect,
                Discord.PermissionsBitField.Flags.ViewChannel,
            ],
        };
        // channel permissions
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
                allow: [Discord.PermissionsBitField.Flags.ManageThreads, Discord.PermissionsBitField.Flags.ViewChannel],
            },
        };
        const off_topic_permissions: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.roles.no_off_topic.id]: no_interaction_at_all,
        };
        const read_only_channel: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                ],
            },
        };
        const read_only_channel_no_reactions: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                ],
            },
        };
        const read_only_archive_channel: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.SendMessagesInThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                    Discord.PermissionsBitField.Flags.UseApplicationCommands,
                ],
            },
        };
        const voice_permissions: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [SET_VOICE_STATUS_PERMISSION_BIT],
            },
            [this.wheatley.roles.no_voice.id]: no_interaction_at_all,
            [this.wheatley.roles.no_off_topic.id]: no_interaction_at_all,
            [this.wheatley.roles.moderators.id]: {
                allow: [
                    Discord.PermissionsBitField.Flags.ViewChannel,
                    Discord.PermissionsBitField.Flags.Connect,
                    SET_VOICE_STATUS_PERMISSION_BIT,
                ],
            },
        };
        const member_voice_channel: permission_overwrites = {
            ...voice_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [Discord.PermissionsBitField.Flags.ViewChannel, SET_VOICE_STATUS_PERMISSION_BIT],
            },
            [this.wheatley.roles.voice_deputy.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
            [this.wheatley.skill_roles.intermediate.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
            [this.wheatley.skill_roles.proficient.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
            [this.wheatley.skill_roles.advanced.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
            [this.wheatley.skill_roles.expert.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
            [this.wheatley.roles.server_booster.id]: { allow: [Discord.PermissionsBitField.Flags.ViewChannel] },
        };
        const mod_only_channel: permission_overwrites = {
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
            [this.wheatley.roles.moderators.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
            [this.wheatley.user.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
        };

        this.add_category_permissions(categories_map.staff_logs, mod_only_channel);
        this.add_category_permissions(categories_map.meta, default_permissions);
        this.add_category_permissions(categories_map.cpp_help, default_permissions);
        this.add_category_permissions(categories_map.c_help, default_permissions);
        this.add_category_permissions(categories_map.discussion, default_permissions);
        this.add_category_permissions(categories_map.specialized, default_permissions);
        this.add_category_permissions(categories_map.community, default_permissions);
        this.add_category_permissions(categories_map.off_topic, off_topic_permissions);
        this.add_category_permissions(categories_map.misc, default_permissions);
        this.add_category_permissions(categories_map.bot_dev, default_permissions);
        this.add_category_permissions(categories_map.voice, voice_permissions);
        this.add_category_permissions(categories_map.archive, read_only_archive_channel);
        this.add_category_permissions(categories_map.private_archive, mod_only_channel);
        this.add_category_permissions(categories_map.challenges_archive, mod_only_channel);
        this.add_category_permissions(categories_map.meta_archive, mod_only_channel);

        // meta overrides
        this.add_channel_overwrite(this.wheatley.channels.rules, {
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                ],
            },
            [this.wheatley.roles.moderators.id]: {
                allow: [
                    Discord.PermissionsBitField.Flags.ManageThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                ],
            },
        });
        this.add_channel_overwrite(this.wheatley.channels.announcements, read_only_channel);
        this.add_channel_overwrite(this.wheatley.channels.resources, read_only_channel);
        this.add_channel_overwrite(this.wheatley.channels.old_resources, read_only_channel);
        this.add_channel_overwrite(this.wheatley.channels.partners, read_only_channel);
        this.add_channel_overwrite(this.wheatley.channels.articles, read_only_channel);
        this.add_channel_overwrite(this.wheatley.channels.server_suggestions, {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                ],
            },
            [this.wheatley.roles.no_suggestions.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.SendMessagesInThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                ],
            },
            [this.wheatley.roles.no_suggestions_at_all.id]: {
                deny: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
        });
        this.add_channel_overwrite(this.wheatley.channels.the_button, {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                ],
            },
        });
        const jedi_council: permission_overwrites = {
            ...mod_only_channel,
            [this.wheatley.roles.jedi_council.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
        };
        this.add_channel_overwrite(this.wheatley.channels.skill_roles_meta, jedi_council);
        this.add_channel_overwrite(this.wheatley.channels.skill_role_suggestions, jedi_council);

        // community overrides
        this.add_channel_overwrite(this.wheatley.channels.polls, {
            ...read_only_channel_no_reactions,
            [this.wheatley.roles.moderators.id]: {
                allow: [
                    Discord.PermissionsBitField.Flags.ManageThreads,
                    Discord.PermissionsBitField.Flags.ViewChannel,
                    Discord.PermissionsBitField.Flags.SendMessages,
                ],
            },
        });
        this.add_channel_overwrite(this.wheatley.channels.today_i_learned, {
            ...default_permissions,
            [this.wheatley.roles.no_til.id]: muted_permissions,
        });
        // off topic overrides
        this.add_channel_overwrite(this.wheatley.channels.memes, {
            ...off_topic_permissions,
            [this.wheatley.roles.no_memes.id]: no_interaction_at_all,
        });
        this.add_channel_overwrite(this.wheatley.channels.starboard, {
            ...off_topic_permissions,
            [this.wheatley.roles.no_memes.id]: no_interaction_at_all,
            ...read_only_channel,
        });
        this.add_channel_overwrite(this.wheatley.channels.pin_archive, {
            ...off_topic_permissions,
            ...read_only_channel,
        });
        this.add_channel_overwrite(this.wheatley.channels.skill_role_log, {
            ...read_only_channel,
        });
        this.add_channel_overwrite(this.wheatley.channels.public_action_log, {
            ...read_only_channel_no_reactions,
        });
        this.add_channel_overwrite(this.wheatley.channels.serious_off_topic, {
            ...off_topic_permissions,
            [this.wheatley.roles.no_serious_off_topic.id]: no_interaction_at_all,
        });
        this.add_channel_overwrite(this.wheatley.channels.room_of_requirement, {
            ...off_topic_permissions,
            [this.wheatley.roles.moderators.id]: {
                allow: [
                    Discord.PermissionsBitField.Flags.ManageThreads,
                    Discord.PermissionsBitField.Flags.ViewChannel,
                    Discord.PermissionsBitField.Flags.ManageChannels,
                ],
            },
        });
        this.add_channel_overwrite(this.wheatley.channels.boosters_only, {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
            [this.wheatley.roles.server_booster.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
        });
        // misc overrides
        this.add_channel_overwrite(this.wheatley.channels.days_since_last_incident, {
            ...default_permissions,
            ...read_only_channel,
        });
        this.add_channel_overwrite(this.wheatley.channels.literally_1984, {
            ...default_permissions,
            ...read_only_channel,
        });
        this.add_channel_overwrite(this.wheatley.channels.lore, {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
            [this.wheatley.roles.historian.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel],
            },
        });
        // bot dev overrides
        this.add_channel_overwrite(this.wheatley.channels.bot_dev_internal, mod_only_channel);
        // voice overrides
        this.add_channel_overwrite(this.wheatley.channels.chill, member_voice_channel);
        this.add_channel_overwrite(this.wheatley.channels.work_3, member_voice_channel);
        this.add_channel_overwrite(this.wheatley.channels.work_4, member_voice_channel);
        this.add_channel_overwrite(this.wheatley.channels.afk, {
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.Speak,
                    Discord.PermissionsBitField.Flags.Stream,
                    Discord.PermissionsBitField.Flags.UseSoundboard,
                    Discord.PermissionsBitField.Flags.SendMessages,
                    Discord.PermissionsBitField.Flags.CreatePublicThreads,
                    Discord.PermissionsBitField.Flags.CreatePrivateThreads,
                    Discord.PermissionsBitField.Flags.SendMessagesInThreads,
                    Discord.PermissionsBitField.Flags.AddReactions,
                    Discord.PermissionsBitField.Flags.UseApplicationCommands,
                ],
            },
        });
        this.add_channel_overwrite(this.wheatley.channels.deans_office, {
            ...voice_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [
                    Discord.PermissionsBitField.Flags.ViewChannel,
                    Discord.PermissionsBitField.Flags.Connect,
                    SET_VOICE_STATUS_PERMISSION_BIT,
                ],
            },
            [this.wheatley.roles.voice_deputy.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel, Discord.PermissionsBitField.Flags.Connect],
            },
        });
    }

    add_category_permissions(category_id: string, permissions: permission_overwrites) {
        this.category_permissions[category_id] = permissions;
    }

    add_channel_overwrite(channel_id: string, permissions: permission_overwrites) {
        this.channel_overrides[channel_id] = permissions;
    }

    async sync_channel_permissions(channel: Discord.CategoryChildChannel, category: Discord.CategoryChannel) {
        if (channel.id in this.channel_overrides) {
            M.log(
                `Setting permissions for channel ${channel.id} ${channel.name} ` +
                    `with category ${category.id} ${category.name}`,
            );
            await channel.permissionOverwrites.set(
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

    async sync_category_permissions(category: Discord.CategoryChannel, permissions: permission_overwrites) {
        M.log(`Setting permissions for category ${category.id} ${category.name}`);
        await category.permissionOverwrites.set(
            Object.entries(permissions).map(([id, permissions]) => ({ id, ...permissions })),
        );
        const channels = category.children.cache.map(channel => channel);
        for (const channel of channels) {
            await this.sync_channel_permissions(channel, category);
        }
    }

    async sync_permissions() {
        await Promise.all(
            Object.entries(this.category_permissions).map(async ([id, permissions]) => {
                const category = await this.wheatley.client.channels.fetch(id);
                if (!category) {
                    throw Error(`Category ${id} not found`);
                }
                if (!(category instanceof Discord.CategoryChannel)) {
                    throw Error(`Category ${id} not of the expected type`);
                }
                await this.sync_category_permissions(category, permissions);
            }),
        );
    }

    override async on_ready() {
        this.setup_permissions_map();
        this.sync_permissions().catch(this.wheatley.critical_error.bind(this.wheatley));
        setTimeout(() => {
            this.sync_permissions().catch(this.wheatley.critical_error.bind(this.wheatley));
        }, HOUR);
    }
}
