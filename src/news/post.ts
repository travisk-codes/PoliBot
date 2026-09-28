import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
} from 'discord.js';
import { fetchHeadlines } from './feeds.js';
import { pickTopStories, type Story } from './pick.js';
import { getConfig, updateConfig } from './store.js';
import { NEWS_TIMEZONE } from './time.js';

const RECENT_LINKS_KEPT = 60;
const RECENT_HEADLINES_KEPT = 9;

export const REQUIRED_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function buildNewsEmbed(stories: Story[], now: Date, byAi = true): EmbedBuilder {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: NEWS_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  const embed = new EmbedBuilder()
    .setTitle(`Top stories for ${date}`)
    .setFooter({
      text: byAi
        ? 'Picked and summarized by AI from public RSS feeds. Check the sources.'
        : 'Latest headlines from public RSS feeds (AI ranking unavailable).',
    })
    .setTimestamp(now);

  stories.forEach((story, i) => {
    const links = story.links.map((l) => `[${l.source}](${l.url})`).join(' · ');
    // Embed field names are capped at 256 chars and values at 1024.
    const summary = truncate(story.summary, 1024 - links.length - 2);
    embed.addFields({
      name: truncate(`${i + 1}. ${story.headline}`, 256),
      value: summary ? `${summary}\n${links}` : links,
    });
  });
  return embed;
}

/** Resolves a guild's news channel, or explains why it can't be used. */
export async function resolveNewsChannel(
  client: Client,
  channelId: string,
): Promise<{ channel: GuildTextBasedChannel } | { error: string }> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.isDMBased() || !channel.isTextBased()) {
    return { error: 'The news channel no longer exists or is not a text channel.' };
  }
  const me = channel.guild.members.me;
  if (!me || !channel.permissionsFor(me).has(REQUIRED_CHANNEL_PERMISSIONS)) {
    return {
      error: `I need **View Channel**, **Send Messages** and **Embed Links** in <#${channel.id}>.`,
    };
  }
  return { channel };
}

/**
 * Fetches headlines, picks the top stories, and posts them. Records what was
 * posted so the next days avoid repeats.
 */
export async function postDailyNews(
  guildId: string,
  channel: GuildTextBasedChannel,
  now = new Date(),
): Promise<void> {
  const config = getConfig(guildId);
  const items = await fetchHeadlines(now, new Set(config?.recentLinks ?? []));
  if (items.length === 0) {
    throw new Error('No news items could be fetched from any feed.');
  }

  const { stories, byAi } = await pickTopStories(items, config?.recentHeadlines ?? []);
  await channel.send({ embeds: [buildNewsEmbed(stories, now, byAi)] });

  if (config) {
    updateConfig(guildId, {
      recentLinks: [
        ...stories.flatMap((s) => s.links.map((l) => l.url)),
        ...(config.recentLinks ?? []),
      ].slice(0, RECENT_LINKS_KEPT),
      recentHeadlines: [
        ...stories.map((s) => s.headline),
        ...(config.recentHeadlines ?? []),
      ].slice(0, RECENT_HEADLINES_KEPT),
    });
  }
}
