import type { Client } from 'discord.js';
import { postDailyNews, resolveNewsChannel } from './post.js';
import { allConfigs, updateConfig } from './store.js';
import { isDue, localDateTime } from './time.js';

const CHECK_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_DAY = 3;

// guildId -> retry state for today's post (in memory; resets on restart).
const attempts = new Map<string, { date: string; count: number; nextTry: number }>();
const inFlight = new Set<string>();

async function tick(client: Client): Promise<void> {
  const now = new Date();
  const today = localDateTime(now).date;

  for (const [guildId, config] of allConfigs()) {
    if (!isDue(now, config) || inFlight.has(guildId)) continue;

    const state = attempts.get(guildId);
    if (state?.date === today) {
      if (state.count >= MAX_ATTEMPTS_PER_DAY || now.getTime() < state.nextTry) continue;
    }

    inFlight.add(guildId);
    try {
      const resolved = await resolveNewsChannel(client, config.channelId);
      if ('error' in resolved) throw new Error(resolved.error);
      await postDailyNews(guildId, resolved.channel, now);
      updateConfig(guildId, { lastPostedDate: today });
      attempts.delete(guildId);
      console.log(`Posted daily news for guild ${guildId}.`);
    } catch (err) {
      const count = (state?.date === today ? state.count : 0) + 1;
      attempts.set(guildId, { date: today, count, nextTry: now.getTime() + RETRY_DELAY_MS });
      console.error(`Daily news for guild ${guildId} failed (attempt ${count}):`, err);
      if (count >= MAX_ATTEMPTS_PER_DAY) {
        // Give up for today so it doesn't retry forever.
        updateConfig(guildId, { lastPostedDate: today });
      }
    } finally {
      inFlight.delete(guildId);
    }
  }
}

export function startNewsScheduler(client: Client): void {
  const run = () => void tick(client).catch((err) => console.error('News scheduler error:', err));
  run();
  setInterval(run, CHECK_INTERVAL_MS);
}
