import * as Discord from "discord.js";
import { strict as assert } from "assert";
import { round, unwrap } from "../utils/misc.js";
import { SelfClearingSet } from "../utils/containers.js";
import { M } from "../utils/debugging-and-logging.js";
import { MINUTE, colors } from "../common.js";
import { BotComponent } from "../bot-component.js";
import { Wheatley } from "../wheatley.js";
import { buzzword_scoreboard_entry } from "../infra/schemata/buzzwords.js";
import { set_interval } from "../utils/node.js";

const ENABLED = false;

const buzzwords = `
adl|argument[ -]dependent(?: name)? lookup;3
alignment requirements?;2
allocator-aware(?:ness)?;3
appearance[ -]ordered;2
base class subobjects?;2
bits? of entropy;2
forward progress guarantee delegation;3
(?:carries|carrying) a? ?(?:dependency|dependencies);2
closure types?;2
complete[ -]class contexts?;3
complete objects?;2
complete types?;2
constant[ -](?:evaluated|evaluations?)|std::is_constant_evaluated;2
constant-initialized;2
constituent expressions?;3
constraints?;1
constraint violations?;2
conversion ranks?;2
(?:copy|move) elisions?;1
copy-and-swap(?: idiom)?;2
coroutine frames?;2
(?:const|volatile|reference|atomic|cv)cv[ -](?:qualified|qualifications?|qualifiers?);1
ctad|ftad|(?:class|function) template argument deduction;2
deduction;1
deduction guides?;1
definition domain;2
delegating constructors?;2
dependency-ordered before;2
dependent types?;2
destroying operator delete;3
(?:direct|copy) list initialization;2
empty base(?: class)? optimization;2
erase[ -]remove(?: idiom)?;2
extended alignment;2
fold[ -]expressions?;1
(?:parallel )?forward progress guarantee;3
full[ -]expressions?;2
function objects?;1
fundamental types?;1
halo|(?:heap )?allocation elision(?: optimizations?)?;2
header units?;2
ill-formed|well-formed,2
ifndr|ill-?formed,? no diagnostics? required;3
immediate contexts?;2
immediate functions?;2
immediate scopes?;2
immediate subexpressions?;2
implementation[ -]defined(?: behaviour)?;2
implicit lifetime;2
implicit object creation|implicitly create[ds](?: objects?);2
include guards?;1
incomplete types?;2
indeterminate values?;2
indeterminately sequenced;2
injected class names?;2
integral promotions?;2
integral types?;1
inter-thread happens before;2
koenig lookup;3
linear congruential(?: engines?| generators?|)|LCGs?;2
local entity|local entities;2
member initializer lists?;2
member subobjects?;2
(?:more|most) (?:specialized|derived);2
(?:named )?return value optimization|NRVO;2
new[ -]extended alignment;3
niebloids?;3
non[ -]allocating allocation functions?;3
non-deduced contexts?;2
object representations?;2
odr-usable;3
odr-used;3
operator overloading;1
overload resolution;1
padding bits?;1
partial ordering of(?: template)? specializations?;3
partial specializations?|partially specialized;2
placement[ -]new;2
points? of instantiation;3
pointer[ -](?:interconvertible|interconvertability);3
potentially concurrent;2
potentially overlapping subobjects?;2
promise[ -]type;2
provides storage|storage-providing|providing storage;2
pseudo-random number generators?|PRNGs?;2
purview;2
(?:un)?qualified name lookup;2
release sequences?;2
replaceable (?:de)?allocation functions?;2
requires expression;2
sequenced (?:before|after);2
simply happens before;1
sized delete;2
std::bit_cast|bit[ -]casting;2
std::launder;3
std::start_lifetime_as;3
std::start_lifetime_as_array;3
stream (?:extraction|insertion) operator;2
strict aliasing;2
strongly happens before;2
subobject of zero size;2
substitution failure is not an error|sfinae;10
subsume;2
suitable created objects?;2
temporary lifetime extensions?;2
temporary materializations?;2
transparently replaceable;3
trivial types?;2
trivially (?:copyable|movable|relocate?able|(?:default-)?constructible);2
type punning,2
undefined behaviou?r|UB;1
underlying types?;1
unevaluated operands?;2
unsequenced;2
unspecified behaviou?r;1
usual arithmetic conversions;2
vacuous initialization;3
value representation;2
visible side effect;3
zero overhead;2
vexing parse;2
most[ -]vexing parse;4
eel.is;5
port70.net;5
lhmouse.com;5
open-std.org;5
timsong-cpp.github.io;5
raii|resource acquisition is initialization;5
decltype(auto);5
`
    .trim()
    .split("\n")
    .map(line => line.split(";"))
    .map(([re, score]) => [new RegExp("\\b(" + re + ")\\b", "gi"), parseInt(score)] as [RegExp, number]);

const derail_points = 100;

const expert = "1091601126551461919";
const advanced = "1091601243585118210";
const proficient = "1091601346525929552";
const intermediate = "1091601365018619936";
const beginner = "1091601379719643207";
const roles = [expert, advanced, proficient, intermediate, beginner];

/**
 * 2023 April Fool's day event. Bases the skill roles on how many C++ buzzwords people use.
 */
export default class Buzzwords extends BotComponent {
    readonly button_message_id = "1069819685786370108";
    button_message: Discord.Message | undefined;
    last_update = {
        epoch: 0,
        timestamp: 0,
        remaining_seconds: 0,
    };
    slowmode: SelfClearingSet<string>;
    timeout: NodeJS.Timeout | null = null;
    interval: NodeJS.Timeout | null = null;

    constructor(wheatley: Wheatley) {
        super(wheatley);
        this.slowmode = new SelfClearingSet<string>(MINUTE / 2, MINUTE / 4);
    }

    override async on_ready() {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (ENABLED) {
            //await this.update_database();
            //this.timeout = set_timeout(() => {
            //    this.update_database().catch(critical_error);
            //}, MINUTE);
            await this.reflowRoles();
            this.interval = set_interval(() => {
                this.reflowRoles().catch(this.wheatley.critical_error.bind(this.wheatley));
            }, 10 * MINUTE);
        }
    }

    static quantile(sorted: number[], q: number) {
        // from so, gets the job done
        const pos = (sorted.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if ((sorted[base + 1] as any) !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        } else {
            return sorted[base];
        }
    }

    async reflowRoles() {
        M.log("Reflowing roles");
        const members = await this.wheatley.TCCPP.members.fetch();
        const entries = await this.wheatley.database.buzzword_scoreboard.find().toArray();
        const scores = entries.map(entry => entry.score).sort((a, b) => a - b);
        const p90 = Buzzwords.quantile(scores, 0.9);
        const p80 = Buzzwords.quantile(scores, 0.7);
        const p70 = Buzzwords.quantile(scores, 0.5);
        const p60 = Buzzwords.quantile(scores, 0.3);
        await Promise.all(
            members.map(async (member, _) => {
                const member_entry = await this.wheatley.database.buzzword_scoreboard.findOne({ user: member.id });
                if (member_entry) {
                    const score = member_entry.score;
                    const current_role_raw = [...member.roles.cache.filter(r => roles.includes(r.id)).keys()];
                    const current_role = current_role_raw.length > 0 ? current_role_raw[0] : null;
                    let new_role: string;
                    if (score >= p90) {
                        new_role = expert;
                    } else if (score >= p80) {
                        new_role = advanced;
                    } else if (score >= p70) {
                        new_role = proficient;
                    } else if (score >= p60) {
                        new_role = intermediate;
                    } else {
                        new_role = beginner;
                    }
                    if (current_role != new_role) {
                        await member.roles.remove(roles);
                        await member.roles.add(new_role);
                    }
                }
            }),
        );
    }

    async updateRolesSingle(member: Discord.GuildMember) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (ENABLED) {
            // TODO: If we ever do this joke again, cache the quantiles from reflowRoles to save an expensive database
            // query and computation here
            const entries = await this.wheatley.database.buzzword_scoreboard.find().toArray();
            const scores = entries.map(entry => entry.score).sort((a, b) => a - b);
            const p90 = Buzzwords.quantile(scores, 0.9);
            const p80 = Buzzwords.quantile(scores, 0.7);
            const p70 = Buzzwords.quantile(scores, 0.5);
            const p60 = Buzzwords.quantile(scores, 0.3);
            const member_entry = await this.wheatley.database.buzzword_scoreboard.findOne({ user: member.id });
            if (member_entry) {
                const score = member_entry.score;
                const current_role_raw = [...member.roles.cache.filter(r => roles.includes(r.id)).keys()];
                const current_role = current_role_raw.length > 0 ? current_role_raw[0] : null;
                let new_role: string;
                if (score >= p90) {
                    new_role = expert;
                } else if (score >= p80) {
                    new_role = advanced;
                } else if (score >= p70) {
                    new_role = proficient;
                } else if (score >= p60) {
                    new_role = intermediate;
                } else {
                    new_role = beginner;
                }
                if (current_role != new_role) {
                    await member.roles.remove(roles);
                    await member.roles.add(new_role);
                }
            }
        }
    }

    async give_points(id: string, tag: string, points: number) {
        await this.wheatley.database.buzzword_scoreboard.updateOne(
            { user: id },
            {
                $set: {
                    user: id,
                    tag,
                },
                $inc: {
                    score: points,
                    count: 1,
                },
            },
            { upsert: true },
        );
    }

    async set_points(id: string, tag: string, points: number) {
        await this.wheatley.database.buzzword_scoreboard.updateOne(
            { user: id },
            {
                $set: {
                    user: id,
                    tag,
                    score: points,
                },
                $inc: {
                    count: 1,
                },
            },
            { upsert: true },
        );
    }

    override async on_message_create(message: Discord.Message) {
        // Ignore bots and DMs
        if (message.author.bot || message.guildId != this.wheatley.TCCPP.id) {
            return;
        }
        //if(message.channel.id != "1091502908241084436") return; // for now, for testing
        if (this.wheatley.is_authorized_mod(message.author)) {
            if (message.content.trim().startsWith("!derailed")) {
                const ids = message.content.match(/\d{10,}/g);
                if (!ids || ids.length != 1) {
                    await message.reply({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(colors.wheatley)
                                .setDescription(
                                    "Error: Must mention exactly one member (either a mention or snowflake)",
                                ),
                        ],
                    });
                } else {
                    const id = ids[0];
                    await message.reply({
                        content: `<@${id}> Congrats!`,
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(colors.wheatley)
                                .setDescription(`You've earned ${derail_points} points!`),
                        ],
                    });
                    const member = await this.wheatley.TCCPP.members.fetch(id);
                    const tag = member.user.tag;
                    await this.give_points(id, tag, derail_points);
                    await this.updateRolesSingle(member);
                }
                return;
            }
            if (message.content.trim().startsWith("!setscore")) {
                const match = message.content.match(/\d{10,}\s+-?\d+/);
                if (match) {
                    const [id, amount] = match[0].split(" ");
                    const member = await (async () => {
                        try {
                            return await this.wheatley.TCCPP.members.fetch(id);
                        } catch {
                            return { user: { tag: "" } };
                        }
                    })();
                    const tag = member.user.tag;
                    await this.set_points(id, tag, parseInt(amount));
                    if (member instanceof Discord.GuildMember) {
                        await this.updateRolesSingle(member);
                    }
                    await message.reply("Done");
                    //await this.update_database();
                } else {
                    await message.reply({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(colors.wheatley)
                                .setDescription(
                                    "Error: Must mention exactly one member (either a mention or snowflake)" +
                                        " and an amount",
                                ),
                        ],
                    });
                }
            }
            if (message.content.trim() == "!clearbuzzscores" && message.author.id == "199943082441965577") {
                await this.wheatley.database.buzzword_scoreboard.deleteMany({});
                return;
            }
            if (message.content.trim() == "!testbuzzquartile" && message.author.id == "199943082441965577") {
                const scoreboard_entries = await this.wheatley.database.buzzword_scoreboard.find().toArray();
                const scores = scoreboard_entries.map(entry => entry.score).sort((a, b) => a - b);
                const p90 = Buzzwords.quantile(scores, 0.9);
                const p80 = Buzzwords.quantile(scores, 0.7);
                const p70 = Buzzwords.quantile(scores, 0.5);
                const p60 = Buzzwords.quantile(scores, 0.3);
                await message.reply(`90: ${p90}\n80: ${p80}\n70: ${p70}\n60: ${p60}`);
                return;
            }
            if (message.content.trim() == "!initbuzzscoresystem" && message.author.id == "199943082441965577") {
                const members = await this.wheatley.TCCPP.members.fetch();
                M.log(members.size, "members");
                await Promise.all(
                    members
                        .filter(member => !member.roles.cache.has(beginner))
                        .map(member => member.roles.add(beginner)),
                );
                return;
            }
        }
        if (message.content.trim() == "!scoreboard") {
            const scoreboard_entries = (await this.wheatley.database.buzzword_scoreboard
                .aggregate([{ $sort: { score: -1 } }, { $limit: 15 }])
                .toArray()) as unknown as buzzword_scoreboard_entry[];
            const embed = new Discord.EmbedBuilder().setTitle("Scoreboard");
            let description = "";
            for (const entry of scoreboard_entries) {
                const tag = entry.tag == "" ? `<@${entry.user}>` : entry.tag;
                description += `${tag}: ${round(entry.score, 1)}\n`;
            }
            embed.setDescription(description);
            await message.reply({
                embeds: [embed],
            });
            return;
        }
        if (message.content.trim() == "!bottom") {
            const scoreboard_entries = await this.wheatley.database.buzzword_scoreboard.find().toArray();
            const entries = scoreboard_entries.sort((a, b) => a.score - b.score);
            const scores = entries.slice(0, 15);
            const embed = new Discord.EmbedBuilder().setTitle("Scoreboard");
            let description = "";
            for (const entry of scores) {
                const tag = entry.tag == "" ? `<@${entry.user}>` : entry.tag;
                description += `${tag}: ${round(entry.score, 1)}\n`;
            }
            embed.setDescription(description);
            await message.reply({
                embeds: [embed],
            });
            return;
        }
        if (message.content.trim() == "!score") {
            const member_entry = await this.wheatley.database.buzzword_scoreboard.findOne({ user: message.author.id });
            await message.reply({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(colors.wheatley)
                        .setDescription(`Score: ${member_entry ? member_entry.score : 0}`),
                ],
            });
        }
        // check the message for buzzwords
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (ENABLED) {
            if (!this.slowmode.has(message.author.id)) {
                let total_score = 0;
                let count = 0;
                for (const [re, score] of buzzwords) {
                    if (message.content.match(re)) {
                        total_score += score;
                        count++;
                    }
                }
                if (total_score > 0) {
                    if (count > 10) {
                        total_score *= -10;
                    } else if (count > 5) {
                        total_score *= -2;
                    }
                    await message.reply({
                        embeds: [
                            new Discord.EmbedBuilder()
                                .setColor(colors.wheatley)
                                .setDescription(`You've earned ${Math.round(total_score * 10) / 10} points!`),
                        ],
                    });
                    await this.give_points(message.author.id, message.author.tag, total_score);
                    await this.updateRolesSingle(unwrap(message.member));
                    this.slowmode.insert(message.author.id);
                }
            }
        }
    }
}
