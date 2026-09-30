import {
  AttachmentBuilder,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { renderPng } from '../compass/plot.js';
import { describeChannels, eligibleChannels, ineligibleReason } from '../personality/channels.js';
import { buildPersonalitySvg, CHART_WIDTH } from '../personality/chart.js';
import {
  anonymizedTexts,
  balancedSample,
  collectMessages,
  hasEnoughText,
  MIN_MESSAGES,
  stratifiedHalves,
} from '../personality/collect.js';
import { averageScores, scoreMessages } from '../personality/score.js';
import { selectTraits, type TraitResult } from '../personality/select.js';
import { getPersonalityStore, type Profile } from '../personality/store.js';
import { getTrait, TRAIT_IDS } from '../personality/traits.js';

const PROFILE_MAX_AGE_MS = 7 * 86_400_000;
const SHOW_COOLDOWN_MS = 60_000;
const LIST_MAX_CHANNELS = 60;
const lastShow = new Map<string, number>();
const calibrating = new Set<string>();

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export const data = new SlashCommandBuilder()
  .setName('personality')
  .setDescription('Opt-in personality profiles estimated from your messages')
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('optin').setDescription('Allow your messages here to be analyzed for a personality profile'))
  .addSubcommand((sub) => sub.setName('optout').setDescription('Stop being analyzed and delete your stored profile'))
  .addSubcommand((sub) =>
    sub
      .setName('show')
      .setDescription('Post a personality chart (you, or someone who opted in)')
      .addUserOption((opt) => opt.setName('user').setDescription('Defaults to you'))
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Only use messages from this channel')
          .addChannelTypes(...TEXT_CHANNEL_TYPES),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('calibrate').setDescription('Admins: test which traits are measurable here and pick the best ones'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('channels')
      .setDescription('Which channels are analyzed')
      .addSubcommand((sub) => sub.setName('list').setDescription('Show which channels are analyzed'))
      .addSubcommand((sub) =>
        sub
          .setName('exclude')
          .setDescription('Admins: stop analyzing a channel')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('include')
          .setDescription('Admins: analyze a channel that is not public')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('reset')
          .setDescription('Admins: back to the default (analyzed only if public)')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel').addChannelTypes(...TEXT_CHANNEL_TYPES).setRequired(true),
          ),
      ),
  );

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

/**
 * Balances the messages across channels, splits each channel into two halves,
 * and scores both halves. Returns 'not enough' below the minimum.
 */
async function buildProfile(byChannel: Map<string, Message[]>): Promise<Profile | 'not enough'> {
  const sample = balancedSample(byChannel);
  const all = [...sample.values()].flat();
  if (!hasEnoughText(all)) return 'not enough';

  const [a, b] = stratifiedHalves(sample);
  // Anonymize against the whole sample so both halves use the same aliases.
  const [halfA, halfB] = await Promise.all([
    scoreMessages(anonymizedTexts(a, all)),
    scoreMessages(anonymizedTexts(b, all)),
  ]);
  return {
    scores: averageScores(halfA, halfB),
    halfA,
    halfB,
    messageCount: all.length,
    channelCount: sample.size,
    updatedAt: new Date().toISOString(),
  };
}

function isFresh(p: Profile | undefined): p is Profile {
  return !!p && Date.now() - Date.parse(p.updatedAt) < PROFILE_MAX_AGE_MS;
}

/** Cached or newly built profile, from all eligible channels or just one. */
async function freshProfile(
  guild: Guild,
  userId: string,
  channel?: GuildTextBasedChannel,
): Promise<Profile | 'not enough'> {
  const store = getPersonalityStore();
  const cached = channel
    ? store.getChannelProfile(guild.id, userId, channel.id)
    : store.getProfile(guild.id, userId);
  if (isFresh(cached)) return cached;

  const channels = channel ? [channel] : eligibleChannels(guild, store.getChannelSettings(guild.id));
  const byUser = await collectMessages(guild, new Set([userId]), channels);
  const profile = await buildProfile(byUser.get(userId) ?? new Map());
  if (profile === 'not enough') return profile;

  if (channel) store.setChannelProfile(guild.id, userId, channel.id, profile);
  else store.setProfile(guild.id, userId, profile);
  return profile;
}

function statusText(r: TraitResult): string {
  switch (r.status) {
    case 'kept':
      return 'kept';
    case 'unreliable':
      return 'dropped: not consistent between halves';
    case 'flat':
      return 'dropped: everyone scores about the same';
    case 'redundant':
      return `dropped: overlaps ${getTrait(r.redundantWith!)?.name} (r=${r.correlation!.toFixed(2)})`;
    case 'over limit':
      return 'dropped: over the 8-trait limit';
  }
}

function mentionList(ids: string[]): string {
  if (ids.length === 0) return 'none';
  const shown = ids.slice(0, LIST_MAX_CHANNELS).map((id) => `<#${id}>`).join(' ');
  return ids.length > LIST_MAX_CHANNELS ? `${shown} and ${ids.length - LIST_MAX_CHANNELS} more` : shown;
}

async function handleChannels(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const guild = interaction.guild;
  const store = getPersonalityStore();
  const sub = interaction.options.getSubcommand();
  const settings = store.getChannelSettings(guild.id);

  if (sub === 'list') {
    const described = describeChannels(guild);
    const eligible = eligibleChannels(guild, settings).map((c) => c.id);
    const addedPrivate = settings.included.filter((id) => described.some((c) => c.id === id && !c.isPublic));
    await interaction.reply({
      ...ephemeral(
        `**Analyzed (${eligible.length}):** ${mentionList(eligible)}\n` +
          `**Excluded by an admin:** ${mentionList(settings.excluded)}\n` +
          `**Non-public channels an admin added:** ${mentionList(addedPrivate)}\n` +
          '-# By default, only channels visible to everyone are analyzed. Threads are not included.',
      ),
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(ephemeral('Only members with Manage Server can change which channels are analyzed.'));
    return;
  }
  const picked = interaction.options.getChannel('channel', true);
  const info = describeChannels(guild).find((c) => c.id === picked.id);
  const name = `#${picked.name}`;
  const note = '\n-# Cached profiles were cleared, since they were built from a different set of channels.';

  if (sub === 'exclude') {
    store.excludeChannel(guild.id, picked.id);
    await interaction.reply(ephemeral(`${name} is no longer analyzed.${note}`));
  } else if (sub === 'include') {
    if (info?.isPublic) {
      store.resetChannel(guild.id, picked.id);
      await interaction.reply(ephemeral(`${name} is public, so it's analyzed by default. Removed any exclusion.${note}`));
    } else {
      store.includeChannel(guild.id, picked.id);
      const readable = info?.botCanRead ? '' : ` I can't read its history yet, so give me View Channel and Read Message History there.`;
      await interaction.reply(
        ephemeral(
          `${name} is now analyzed. It isn't visible to everyone, and charts built partly from it are **posted publicly**, so only include it if its members are fine with that.${readable}${note}`,
        ),
      );
    }
  } else if (sub === 'reset') {
    store.resetChannel(guild.id, picked.id);
    await interaction.reply(
      ephemeral(`${name} is back to the default: ${info?.isPublic ? 'analyzed, since it is public' : 'not analyzed, since it is not public'}.${note}`),
    );
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply(ephemeral('This command only works in a server.'));
    return;
  }
  if (interaction.options.getSubcommandGroup(false) === 'channels') {
    await handleChannels(interaction);
    return;
  }

  const guild = interaction.guild;
  const store = getPersonalityStore();
  const userId = interaction.user.id;

  switch (interaction.options.getSubcommand()) {
    case 'optin': {
      store.optIn(guild.id, userId);
      await interaction.reply(
        ephemeral(
          "You're opted in. When someone runs `/personality show` on you, the bot reads your messages from the last 90 days " +
            'in channels everyone can see (plus any an admin added; `/personality channels list` shows them), balanced across channels. ' +
            'It sends them to the AI with usernames anonymized and **posts the chart publicly**. ' +
            'Only scores are saved, never message text. `/personality optout` deletes everything.',
        ),
      );
      return;
    }

    case 'optout': {
      const was = store.optOut(guild.id, userId);
      await interaction.reply(ephemeral(was ? 'Opted out. Your stored profile was deleted.' : "You weren't opted in."));
      return;
    }

    case 'show': {
      const target = interaction.options.getUser('user') ?? interaction.user;
      if (target.bot || !store.isOptedIn(guild.id, target.id)) {
        await interaction.reply(
          ephemeral(
            target.id === userId
              ? 'Run `/personality optin` first.'
              : `${target.username} hasn't opted in, so they can't be analyzed.`,
          ),
        );
        return;
      }

      const settings = store.getChannelSettings(guild.id);
      const picked = interaction.options.getChannel('channel');
      let channel: GuildTextBasedChannel | undefined;
      if (picked) {
        const info = describeChannels(guild).find((c) => c.id === picked.id);
        const reason = ineligibleReason(info, settings);
        if (reason || !info) {
          await interaction.reply(ephemeral(reason ?? "That channel can't be analyzed."));
          return;
        }
        channel = info.channel;
      } else if (eligibleChannels(guild, settings).length === 0) {
        await interaction.reply(
          ephemeral('No channels are analyzed here: none are visible to everyone. An admin can add some with `/personality channels include`.'),
        );
        return;
      }

      const last = lastShow.get(userId);
      if (last && Date.now() - last < SHOW_COOLDOWN_MS) {
        await interaction.reply(ephemeral('Please wait a minute between charts.'));
        return;
      }
      lastShow.set(userId, Date.now());

      await interaction.deferReply();
      try {
        const profile = await freshProfile(guild, target.id, channel);
        const name = (await guild.members.fetch(target.id).catch(() => null))?.displayName ?? target.username;
        const where = channel ? ` in #${channel.name}` : '';
        if (profile === 'not enough') {
          await interaction.editReply(
            `Not enough to go on for ${name}${where} yet: it needs at least ${MIN_MESSAGES} messages (of 3+ words) in the last 90 days.`,
          );
          return;
        }

        const dims = store.dimensions(guild.id);
        const rows = dims.ids.flatMap((id) => {
          const t = getTrait(id);
          return t ? [{ name: t.name, low: t.low, high: t.high, value: profile.scores[id] ?? 0 }] : [];
        });
        const source = channel
          ? `${profile.messageCount} messages in #${channel.name}`
          : `${profile.messageCount} messages across ${profile.channelCount ?? 1} channel${profile.channelCount === 1 ? '' : 's'}`;
        const traits = dims.calibratedAt ? 'traits chosen by /personality calibrate' : 'default traits (not calibrated yet)';
        const { svg } = buildPersonalitySvg({
          title: `Personality · ${name}${where}`,
          subtitle: `${source} · ${traits}`,
          rows,
          footer: 'AI estimate from writing style. For fun, not a diagnosis.',
        });
        await interaction.editReply({
          files: [new AttachmentBuilder(renderPng(svg, CHART_WIDTH), { name: 'personality.png' })],
        });
      } catch (err) {
        console.error('personality show failed:', err);
        lastShow.delete(userId);
        await interaction.editReply('Sorry, something went wrong building that profile.');
      }
      return;
    }

    case 'calibrate': {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply(ephemeral('Only members with Manage Server can calibrate.'));
        return;
      }
      if (calibrating.has(guild.id)) {
        await interaction.reply(ephemeral('Calibration is already running.'));
        return;
      }
      const users = store.optedInUsers(guild.id);
      if (users.length === 0) {
        await interaction.reply(ephemeral('Nobody has opted in yet.'));
        return;
      }
      const channels = eligibleChannels(guild, store.getChannelSettings(guild.id));
      if (channels.length === 0) {
        await interaction.reply(
          ephemeral('No channels are analyzed here: none are visible to everyone. Add some with `/personality channels include`.'),
        );
        return;
      }

      calibrating.add(guild.id);
      await interaction.deferReply();
      try {
        await interaction.editReply(`Reading ${channels.length} channels for ${users.length} opted-in members…`);
        const byUser = await collectMessages(guild, new Set(users), channels);

        const halves: Array<{ a: Profile['halfA']; b: Profile['halfB'] }> = [];
        let done = 0;
        for (const id of users) {
          try {
            const profile = await buildProfile(byUser.get(id) ?? new Map());
            if (profile === 'not enough') continue;
            store.setProfile(guild.id, id, profile);
            halves.push({ a: profile.halfA, b: profile.halfB });
          } catch (err) {
            console.error(`personality scoring failed for ${id}:`, err);
          }
          done++;
          if (done % 3 === 0) await interaction.editReply(`Scoring… ${done} members done.`);
        }

        const sel = selectTraits(halves, TRAIT_IDS);
        if (!sel.tested) {
          await interaction.editReply(
            `Only ${sel.members} opted-in member(s) have enough messages (${MIN_MESSAGES}+); at least 5 are needed to test traits. ` +
              'Keeping the default traits for now. Their profiles were cached.',
          );
          return;
        }
        if (sel.chosen.length === 0) {
          await interaction.editReply('No trait passed the tests with this data, so the default traits stay. Try again with more members or messages.');
          return;
        }
        store.setDimensions(guild.id, sel.chosen);

        const lines = sel.results
          .sort((x, y) => (x.status === 'kept' ? 0 : 1) - (y.status === 'kept' ? 0 : 1))
          .map((r) => {
            const name = (getTrait(r.id)?.name ?? r.id).padEnd(20);
            const rel = r.reliability === null ? '  n/a' : r.reliability.toFixed(2).padStart(5);
            return `${name} ${rel}  ${r.spread.toFixed(2)}  ${statusText(r)}`;
          });
        await interaction.editReply(
          `**Calibrated on ${sel.members} members.** Kept ${sel.chosen.length} traits.\n` +
            '```\n' +
            `${'Trait'.padEnd(20)} ${'Rel.'.padStart(5)}  Sprd  Result\n` +
            lines.join('\n') +
            '\n```\n' +
            '-# Rel. = split-half reliability (Spearman-Brown); Sprd = standard deviation across members.',
        );
      } catch (err) {
        console.error('personality calibrate failed:', err);
        await interaction.editReply('Sorry, calibration failed. Check the bot logs.');
      } finally {
        calibrating.delete(guild.id);
      }
      return;
    }
  }
}
