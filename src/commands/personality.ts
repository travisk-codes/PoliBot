import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
} from 'discord.js';
import { renderPng } from '../compass/plot.js';
import { buildPersonalitySvg, CHART_WIDTH } from '../personality/chart.js';
import { anonymizedTexts, collectMessages, hasEnoughText, MIN_MESSAGES } from '../personality/collect.js';
import { averageScores, scoreMessages, splitHalves } from '../personality/score.js';
import { selectTraits, type TraitResult } from '../personality/select.js';
import { getPersonalityStore, type Profile } from '../personality/store.js';
import { getTrait, TRAIT_IDS } from '../personality/traits.js';

const PROFILE_MAX_AGE_MS = 7 * 86_400_000;
const SHOW_COOLDOWN_MS = 60_000;
const lastShow = new Map<string, number>();
const calibrating = new Set<string>();

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
      .addUserOption((opt) => opt.setName('user').setDescription('Defaults to you')),
  )
  .addSubcommand((sub) =>
    sub.setName('calibrate').setDescription('Admins: test which traits are measurable here and pick the best ones'),
  );

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

/** Scores two interleaved halves of the texts and averages them. */
async function buildProfile(texts: string[]): Promise<Profile> {
  const [a, b] = splitHalves(texts);
  const [halfA, halfB] = await Promise.all([scoreMessages(a), scoreMessages(b)]);
  return {
    scores: averageScores(halfA, halfB),
    halfA,
    halfB,
    messageCount: texts.length,
    updatedAt: new Date().toISOString(),
  };
}

async function freshProfile(guild: Guild, userId: string): Promise<Profile | 'not enough'> {
  const store = getPersonalityStore();
  const cached = store.getProfile(guild.id, userId);
  if (cached && Date.now() - Date.parse(cached.updatedAt) < PROFILE_MAX_AGE_MS) return cached;

  const msgs = (await collectMessages(guild, new Set([userId]))).get(userId) ?? [];
  const texts = anonymizedTexts(msgs);
  if (!hasEnoughText(texts)) return 'not enough';
  const profile = await buildProfile(texts);
  store.setProfile(guild.id, userId, profile);
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

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply(ephemeral('This command only works in a server.'));
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
          "You're opted in. When someone runs `/personality show` on you, the bot reads your recent messages in this server " +
            '(last 90 days, channels it can see), sends them to the AI with usernames anonymized, and **posts the chart publicly**. ' +
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
      const last = lastShow.get(userId);
      if (last && Date.now() - last < SHOW_COOLDOWN_MS) {
        await interaction.reply(ephemeral('Please wait a minute between charts.'));
        return;
      }
      lastShow.set(userId, Date.now());

      await interaction.deferReply();
      try {
        const profile = await freshProfile(guild, target.id);
        const name = (await guild.members.fetch(target.id).catch(() => null))?.displayName ?? target.username;
        if (profile === 'not enough') {
          await interaction.editReply(
            `Not enough to go on for ${name} yet: it needs at least ${MIN_MESSAGES} messages (of 3+ words) in the last 90 days.`,
          );
          return;
        }

        const dims = store.dimensions(guild.id);
        const rows = dims.ids.flatMap((id) => {
          const t = getTrait(id);
          return t ? [{ name: t.name, low: t.low, high: t.high, value: profile.scores[id] ?? 0 }] : [];
        });
        const { svg } = buildPersonalitySvg({
          title: `Personality · ${name}`,
          subtitle: `${profile.messageCount} messages analyzed · ${dims.calibratedAt ? 'traits chosen by /personality calibrate' : 'default traits (not calibrated yet)'}`,
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

      calibrating.add(guild.id);
      await interaction.deferReply();
      try {
        await interaction.editReply(`Reading messages for ${users.length} opted-in members…`);
        const byUser = await collectMessages(guild, new Set(users));

        const halves: Array<{ a: Profile['halfA']; b: Profile['halfB'] }> = [];
        let done = 0;
        for (const id of users) {
          const texts = anonymizedTexts(byUser.get(id) ?? []);
          if (!hasEnoughText(texts)) continue;
          try {
            const profile = await buildProfile(texts);
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
