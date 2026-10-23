import {
  ChatInputCommandInteraction,
  MessageFlags,
  type InteractionReplyOptions,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import {
  fetchRecentMessages,
  registerUsers,
  toTranscriptMessage,
} from '../discord/fetchMessages.js';
import { buildJudgmentEmbed, judge } from '../judge/judge.js';
import { Pseudonymizer } from '../summary/anonymize.js';
import { formatDuration, formatMessages, truncateToBudget } from '../summary/format.js';

const DEFAULT_COUNT = 150;
const MAX_COUNT = 500;
const MAX_MINUTES = 24 * 60;
const COOLDOWN_MS = 2 * 60_000;
const TRANSCRIPT_CHAR_BUDGET = 60_000;
export const MIN_MESSAGES = 10;
export const MIN_PARTICIPANTS = 2;

// channelId -> last time /judge was run there
const lastUsed = new Map<string, number>();

export const data = new SlashCommandBuilder()
  .setName('judge')
  .setDescription("Judge who's making the better-supported argument in this channel")
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt.setName('topic').setDescription('What the argument is about (default: the main disagreement)').setMaxLength(200),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('count')
      .setDescription(`How many recent messages to read (default ${DEFAULT_COUNT})`)
      .setMinValue(MIN_MESSAGES)
      .setMaxValue(MAX_COUNT),
  )
  .addIntegerOption((opt) =>
    opt
      .setName('time')
      .setDescription('Only messages from the last N minutes (up to 1440)')
      .setMinValue(1)
      .setMaxValue(MAX_MINUTES),
  );

/**
 * Posts `payload` as a new public message after a private deferred reply.
 * The first follow-up after a deferred reply edits that deferred message
 * (keeping it private), so the deferred reply is used up with a placeholder
 * first, then the public follow-up is sent, then the placeholder is removed.
 */
export async function postPublicly(
  interaction: Pick<ChatInputCommandInteraction, 'editReply' | 'followUp' | 'deleteReply'>,
  payload: Omit<InteractionReplyOptions, 'flags' | 'allowedMentions'>,
): Promise<void> {
  await interaction.editReply('Posting the verdict…');
  await interaction.followUp({ ...payload, allowedMentions: { parse: [] } });
  await interaction.deleteReply().catch(() => {});
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!interaction.inGuild() || !channel || channel.isDMBased() || !channel.isTextBased()) {
    await interaction.reply({ content: 'This command only works in server text channels.', flags: MessageFlags.Ephemeral });
    return;
  }

  const me = interaction.guild?.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
    await interaction.reply({
      content: 'I need **View Channel** and **Read Message History** permissions here.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = Date.now();
  const last = lastUsed.get(channel.id);
  if (last && now - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    await interaction.reply({
      content: `This channel was judged recently. Try again in ${wait}s.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  lastUsed.set(channel.id, now);

  const topic = interaction.options.getString('topic')?.trim() || null;
  const countOption = interaction.options.getInteger('count');
  const minutes = interaction.options.getInteger('time');
  const count = countOption ?? (minutes ? MAX_COUNT : DEFAULT_COUNT);
  const since = minutes ? now - minutes * 60_000 : undefined;
  const window = minutes ? `last ${formatDuration(minutes)}` : undefined;

  // Defer privately so "not enough to judge" stays private; the verdict itself
  // is posted publicly by postPublicly().
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const messages = await fetchRecentMessages(channel, count, since);
    // The AI only sees User1, User2, ...; real names are restored afterwards.
    const pseudo = new Pseudonymizer();
    for (const m of messages) registerUsers(m, pseudo);
    const transcript = messages.map((m) => toTranscriptMessage(m, pseudo));
    const lines = formatMessages(transcript);
    const participants = new Set(
      transcript.filter((t) => !t.isBot && !t.isSystem && t.content.trim()).map((t) => t.authorName),
    );

    if (lines.length < MIN_MESSAGES || participants.size < MIN_PARTICIPANTS) {
      lastUsed.delete(channel.id);
      await interaction.editReply(
        `Not enough discussion to judge${window ? ` in the ${window}` : ''}: it needs at least ${MIN_MESSAGES} messages from ${MIN_PARTICIPANTS} or more people.`,
      );
      return;
    }

    const { lines: kept } = truncateToBudget(lines, TRANSCRIPT_CHAR_BUDGET);
    const judgment = await judge(kept.join('\n'), topic, participants);
    const embed = buildJudgmentEmbed(judgment, (s) => pseudo.restore(s), {
      messageCount: kept.length,
      window,
    });

    await postPublicly(interaction, {
      content: `Requested by ${interaction.user}${topic ? ` · topic: "${topic}"` : ''}`,
      embeds: [embed],
    });
  } catch (err) {
    console.error('judge failed:', err);
    lastUsed.delete(channel.id);
    await interaction.editReply('Sorry, something went wrong judging that discussion.');
  }
}
