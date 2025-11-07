import * as Discord from "discord.js";

import { strict as assert } from "assert";

import { M } from "../../../utils/debugging-and-logging.js";
import { HOUR } from "../../../common.js";
import { BotComponent } from "../../../bot-component.js";
import SkillRoles from "./skill-roles.js";
import { Wheatley } from "../../../wheatley.js";
import { unwrap } from "../../../utils/misc.js";
import { CommandSetBuilder } from "../../../command-abstractions/command-set-builder.js";

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

type permission_overwrites = Partial<Record<string, permissions_entry>>;

const SET_VOICE_STATUS_PERMISSION_BIT = 1n << 48n; // TODO: Replace once discord.js supports this in PermissionsBitField

export default class PermissionManager extends BotComponent {
    private skill_roles!: SkillRoles;

    category_permissions: Partial<Record<string, permission_overwrites>> = {};
    channel_overwrites: Partial<Record<string, permission_overwrites>> = {};
    dynamic_channel_overwrites: Partial<Record<string, permission_overwrites>> = {};

    override async setup(commands: CommandSetBuilder) {
        this.skill_roles = unwrap(this.wheatley.components.get("SkillRoles")) as SkillRoles;
    }

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
                allow: [
                    Discord.PermissionsBitField.Flags.ViewChannel,
                    Discord.PermissionsBitField.Flags.ManageThreads,
                    Discord.PermissionsBitField.Flags.Connect,
                    Discord.PermissionsBitField.Flags.Speak,
                    Discord.PermissionsBitField.Flags.Stream,
                    SET_VOICE_STATUS_PERMISSION_BIT,
                ],
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
        const acive_voice_permissions = [
            Discord.PermissionsBitField.Flags.Speak,
            Discord.PermissionsBitField.Flags.Stream,
        ];
        const voice_permissions: permission_overwrites = {
            ...default_permissions,
            [this.wheatley.guild.roles.everyone.id]: {
                deny: [...acive_voice_permissions, SET_VOICE_STATUS_PERMISSION_BIT],
            },
            [this.wheatley.roles.official_bot.id]: { allow: acive_voice_permissions },
            [this.wheatley.roles.voice.id]: { allow: acive_voice_permissions },
            [this.skill_roles.roles.Intermediate.id]: { allow: acive_voice_permissions },
            [this.skill_roles.roles.Proficient.id]: { allow: acive_voice_permissions },
            [this.skill_roles.roles.Advanced.id]: { allow: acive_voice_permissions },
            [this.skill_roles.roles.Expert.id]: { allow: acive_voice_permissions },
            [this.wheatley.roles.server_booster.id]: { allow: acive_voice_permissions },
            [this.wheatley.roles.no_voice.id]: no_interaction_at_all,
            [this.wheatley.roles.no_off_topic.id]: no_interaction_at_all,
            [this.wheatley.roles.voice_moderator.id]: {
                allow: [...acive_voice_permissions, SET_VOICE_STATUS_PERMISSION_BIT],
            },
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

        // meta overwrites
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

        // community overwrites
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
        // off topic overwrites
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
        // misc overwrites
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
        // bot dev overwrites
        this.add_channel_overwrite(this.wheatley.channels.bot_dev_internal, mod_only_channel);
        // voice overwrites
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
            [this.wheatley.roles.voice_moderator.id]: {
                allow: [Discord.PermissionsBitField.Flags.ViewChannel, Discord.PermissionsBitField.Flags.Connect],
            },
        });
    }

    add_category_permissions(category_id: string, permissions: permission_overwrites) {
        this.category_permissions[category_id] = permissions;
    }

    add_channel_overwrite(channel_id: string, permissions: permission_overwrites) {
        this.channel_overwrites[channel_id] = permissions;
    }

    private async set_channel_permissions(channel: Discord.CategoryChildChannel, permissions: permission_overwrites) {
        await channel.permissionOverwrites.set(
            Object.entries(permissions).map(([id, permissions]) => ({
                id,
                ...permissions,
            })),
        );
    }

    async sync_channel_permissions(channel: Discord.CategoryChildChannel) {
        if (channel.id in this.dynamic_channel_overwrites) {
            M.log(`Setting dynamic permissions for channel ${channel.id} ${channel.name}`);
            await this.set_channel_permissions(channel, unwrap(this.dynamic_channel_overwrites[channel.id]));
            return;
        }
        if (channel.id in this.channel_overwrites) {
            M.log(`Setting permissions for channel ${channel.id} ${channel.name}`);
            await this.set_channel_permissions(channel, unwrap(this.channel_overwrites[channel.id]));
            return;
        }
        M.log(`Syncing channel ${channel.id} ${channel.name}`);
        await channel.lockPermissions();
    }

    async sync_category_permissions(category: Discord.CategoryChannel, permissions: permission_overwrites) {
        M.log(`Setting permissions for category ${category.id} ${category.name}`);
        await category.permissionOverwrites.set(
            Object.entries(permissions).map(([id, permissions]) => ({ id, ...permissions })),
        );
        const channels = category.children.cache.map(channel => channel);
        for (const channel of channels) {
            await this.sync_channel_permissions(channel);
            if (channel.isVoiceBased()) {
                for (const [id, member] of channel.members) {
                    if (await this.wheatley.check_permissions(member, Discord.PermissionFlagsBits.MuteMembers)) {
                        await this.mod_has_entered_the_building(channel);
                        break;
                    }
                }
            }
        }
    }

    async sync_permissions() {
        await Promise.all(
            Object.entries(this.category_permissions).map(async ([id, permissions]) => {
                const category = await this.utilities.get_category(id);
                await this.sync_category_permissions(category, unwrap(permissions));
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

    private async mod_has_entered_the_building(channel: Discord.Channel) {
        assert(channel.isVoiceBased());
        if (channel.id in this.dynamic_channel_overwrites || channel.id == this.wheatley.guild.afkChannelId) {
            return;
        }
        const everyone = this.wheatley.guild.roles.everyone.id;
        const base_perms =
            this.channel_overwrites[channel.id] ??
            (channel.parent ? this.category_permissions[channel.parent.id] : undefined);
        if (
            !base_perms ||
            !base_perms[everyone] ||
            !base_perms[everyone].deny ||
            !base_perms[everyone].deny.includes(Discord.PermissionsBitField.Flags.Speak) ||
            !base_perms[everyone].deny.includes(Discord.PermissionsBitField.Flags.Stream)
        ) {
            return;
        }
        const perms = Object.assign({}, base_perms);
        perms[everyone] = {
            allow: [
                Discord.PermissionsBitField.Flags.Speak,
                Discord.PermissionsBitField.Flags.Stream,
                ...(perms[everyone]?.allow ?? []),
            ],
            deny: perms[everyone]?.deny,
        };
        this.dynamic_channel_overwrites[channel.id] = perms;
        await this.sync_channel_permissions(channel);
    }

    private async mod_has_left_the_building(channel: Discord.Channel) {
        assert(channel.isVoiceBased());
        if (!(channel.id in this.dynamic_channel_overwrites)) {
            return;
        }
        for (const [id, member] of channel.members) {
            if (await this.wheatley.check_permissions(member, Discord.PermissionFlagsBits.MuteMembers)) {
                return;
            }
        }
        delete this.dynamic_channel_overwrites[channel.id];
        await this.sync_channel_permissions(channel);
    }

    override async on_voice_state_update(old_state: Discord.VoiceState, new_state: Discord.VoiceState) {
        if (
            new_state.member &&
            new_state.member.permissions.has(Discord.PermissionFlagsBits.MuteMembers) &&
            new_state.channelId != old_state.channelId
        ) {
            if (old_state.channel) {
                await this.mod_has_left_the_building(old_state.channel);
            }
            if (new_state.channel) {
                await this.mod_has_entered_the_building(new_state.channel);
            }
        }
    }
}
