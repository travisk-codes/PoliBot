import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { fetchRecentMessages, toTranscriptMessage } from '../discord/fetchMessages.js';
import { chunkText, formatMessages, truncateToBudget } from '../summary/format.js';
import { summarize } from '../summary/llm.js';

const DEFAULT_COUNT = 50;
const MAX_COUNT = 500;
const COOLDOWN_MS = 30_000;
// Rough cap on transcript size sent to the model.
const TRANSCRIPT_CHAR_BUDGET = 60_000;
const EMBED_DESCRIPTION_LIMIT = 4096;

const lastUsed = new Map<string, number>();

export const data = new SlashCommandBuilder()
  .setName('summarize')
  .setDescription('Privately summarize the last messages in this channel')
  .setDMPermission(false)
  .addIntegerOption((opt) =>
    opt
      .setName('count')
      .setDescription(`How many messages to summarize (default ${DEFAULT_COUNT})`)
      .setMinValue(1)
      .setMaxValue(MAX_COUNT),
  )
  .addBooleanOption((opt) =>
    opt.setName('include_bots').setDescription('Include messages from bots (default: no)'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!interaction.inGuild() || !channel || channel.isDMBased() || !channel.isTextBased()) {
    await interaction.reply({
      content: 'This command only works in server text channels.',
      flags: MessageFlags.Ephemeral,
    });
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
  const last = lastUsed.get(interaction.user.id);
  if (last && now - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    await interaction.reply({
      content: `Please wait ${wait}s before summarizing again.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  lastUsed.set(interaction.user.id, now);

  const count = interaction.options.getInteger('count') ?? DEFAULT_COUNT;
  const includeBots = interaction.options.getBoolean('include_bots') ?? false;

  // The LLM call can exceed Discord's 3s reply window, so defer first.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const messages = await fetchRecentMessages(channel, count);
    const lines = formatMessages(messages.map(toTranscriptMessage), { includeBots });
    if (lines.length === 0) {
      await interaction.editReply('There are no messages with content to summarize.');
      return;
    }

    const { lines: kept, dropped } = truncateToBudget(lines, TRANSCRIPT_CHAR_BUDGET);
    const summary = await summarize(kept.join('\n'), channel.name);

    let footer = `${kept.length} messages summarized`;
    if (dropped > 0) footer += ` (${dropped} oldest omitted to fit length limit)`;

    const [first, ...rest] = chunkText(summary, EMBED_DESCRIPTION_LIMIT);
    const embed = new EmbedBuilder()
      .setTitle(`Summary of #${channel.name}`)
      .setDescription(first)
      .setFooter({ text: footer });
    await interaction.editReply({ embeds: [embed] });

    for (const chunk of rest) {
      await interaction.followUp({
        embeds: [new EmbedBuilder().setDescription(chunk)],
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error('summarize failed:', err);
    lastUsed.delete(interaction.user.id);
    await interaction.editReply('Sorry, something went wrong while generating the summary.');
  }
}
