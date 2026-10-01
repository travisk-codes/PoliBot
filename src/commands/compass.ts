import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { buildCompassSvg, renderPng } from '../compass/plot.js';
import { getCompassStore } from '../compass/sheet.js';
import { AXIS_MAX, AXIS_MIN, quadrantName } from '../compass/types.js';

const TEST_URL = 'https://www.politicalcompass.org/test';
const PLOT_COOLDOWN_MS = 15_000;
const lastPlot = new Map<string, number>();

export const data = new SlashCommandBuilder()
  .setName('compass')
  .setDescription('Share your political compass results and see everyone\'s on a chart')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Save your political compass coordinates')
      .addNumberOption((opt) =>
        opt
          .setName('economic')
          .setDescription('Economic Left/Right, from -10 (left) to 10 (right)')
          .setMinValue(AXIS_MIN)
          .setMaxValue(AXIS_MAX)
          .setRequired(true),
      )
      .addNumberOption((opt) =>
        opt
          .setName('social')
          .setDescription('Social Libertarian/Authoritarian, from -10 (libertarian) to 10 (authoritarian)')
          .setMinValue(AXIS_MIN)
          .setMaxValue(AXIS_MAX)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('plot').setDescription('Post a chart of everyone\'s coordinates in this server'),
  )
  .addSubcommand((sub) => sub.setName('show').setDescription('Show the coordinates you saved'))
  .addSubcommand((sub) => sub.setName('remove').setDescription('Delete your saved coordinates'));

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

function formatCoords(economic: number, social: number): string {
  return `Economic **${economic}**, Social **${social}** (${quadrantName(economic, social)})`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply(ephemeral('This command only works in a server.'));
    return;
  }
  const store = getCompassStore();
  if (!store) {
    await interaction.reply(
      ephemeral('The compass spreadsheet isn\'t set up yet. Ask the bot owner to follow the Google Sheets steps in the README.'),
    );
    return;
  }
  const { guildId } = interaction;
  const userId = interaction.user.id;

  switch (interaction.options.getSubcommand()) {
    case 'set': {
      // Round to 2 decimals, matching how the test reports results.
      const economic = Math.round(interaction.options.getNumber('economic', true) * 100) / 100;
      const social = Math.round(interaction.options.getNumber('social', true) * 100) / 100;
      const member = interaction.guild?.members.cache.get(userId);
      const name = member?.displayName ?? interaction.user.displayName;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await store.upsert({
        guildId,
        userId,
        name,
        economic,
        social,
        updatedAt: new Date().toISOString(),
      });
      await interaction.editReply(
        `Saved: ${formatCoords(economic, social)}. Use \`/compass plot\` to see everyone.\n` +
          '-# Your display name and coordinates are stored in a Google Sheet the bot owner can see. ' +
          '`/compass remove` deletes them.',
      );
      return;
    }

    case 'plot': {
      const last = lastPlot.get(interaction.channelId);
      if (last && Date.now() - last < PLOT_COOLDOWN_MS) {
        await interaction.reply(ephemeral('A chart was just posted here. Try again in a few seconds.'));
        return;
      }
      lastPlot.set(interaction.channelId, Date.now());

      await interaction.deferReply();
      const entries = await store.list(guildId);
      if (entries.length === 0) {
        await interaction.editReply(
          `No one here has saved coordinates yet. Take the test at ${TEST_URL}, then use \`/compass set\`.`,
        );
        return;
      }

      // Prefer current server nicknames over the name saved at /compass set time.
      const members = interaction.guild?.members.cache;
      const points = entries.map((e) => ({
        name: members?.get(e.userId)?.displayName ?? e.name,
        economic: e.economic,
        social: e.social,
        highlight: e.userId === userId,
      }));

      const title = `Political compass · ${interaction.guild?.name ?? 'this server'}`;
      const { svg } = buildCompassSvg(points, title);
      const file = new AttachmentBuilder(renderPng(svg), { name: 'political-compass.png' });

      const lines = [`Add yourself with \`/compass set\` (test: <${TEST_URL}>).`];
      await interaction.editReply({
        content: lines.join('\n'),
        files: [file],
        allowedMentions: { parse: [] },
      });
      return;
    }

    case 'show': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const entry = await store.get(guildId, userId);
      await interaction.editReply(
        entry
          ? `Your saved coordinates: ${formatCoords(entry.economic, entry.social)}.`
          : `You haven't saved coordinates here yet. Take the test at <${TEST_URL}>, then use \`/compass set\`.`,
      );
      return;
    }

    case 'remove': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const removed = await store.remove(guildId, userId);
      await interaction.editReply(
        removed ? 'Your coordinates were deleted.' : 'You had no saved coordinates here.',
      );
      return;
    }
  }
}
