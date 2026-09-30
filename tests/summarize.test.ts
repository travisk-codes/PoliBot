import { Collection } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { data } from '../src/commands/summarize.js';
import { fetchRecentMessages } from '../src/discord/fetchMessages.js';
import { formatDuration } from '../src/summary/format.js';

/** A fake channel with `total` messages, one per minute, the newest at `now`. */
function fakeChannel(total: number, now: number) {
  // Newest first, like Discord.
  const all = Array.from({ length: total }, (_, i) => ({
    id: String(total - i),
    createdTimestamp: now - i * 60_000,
  }));
  let calls = 0;
  const channel = {
    messages: {
      fetch: async ({ limit, before }: { limit: number; before?: string }) => {
        calls++;
        const start = before ? all.findIndex((m) => m.id === before) + 1 : 0;
        return new Collection(all.slice(start, start + limit).map((m) => [m.id, m]));
      },
    },
  };
  return { channel: channel as any, calls: () => calls };
}

const NOW = 1_800_000_000_000;

describe('fetchRecentMessages', () => {
  it('without since, returns the last `count` messages oldest first', async () => {
    const { channel } = fakeChannel(300, NOW);
    const msgs = await fetchRecentMessages(channel, 150);
    expect(msgs).toHaveLength(150);
    expect(msgs[0].createdTimestamp).toBeLessThan(msgs[149].createdTimestamp);
  });

  it('with since, keeps only messages inside the window', async () => {
    const { channel } = fakeChannel(300, NOW);
    const since = NOW - 30 * 60_000; // last 30 minutes -> 31 messages (0..30 minutes ago)
    const msgs = await fetchRecentMessages(channel, 500, since);
    expect(msgs).toHaveLength(31);
    expect(msgs.every((m) => m.createdTimestamp >= since)).toBe(true);
    expect(msgs[0].createdTimestamp).toBe(since);
  });

  it('stops paging once the window is crossed', async () => {
    const { channel, calls } = fakeChannel(1000, NOW);
    await fetchRecentMessages(channel, 500, NOW - 150 * 60_000); // 151 messages, second page crosses
    expect(calls()).toBe(2);
  });

  it('count still caps results inside the window', async () => {
    const { channel } = fakeChannel(300, NOW);
    const msgs = await fetchRecentMessages(channel, 10, NOW - 60 * 60_000);
    expect(msgs).toHaveLength(10);
    expect(msgs[9].createdTimestamp).toBe(NOW); // the most recent 10
  });

  it('returns nothing when the window is empty', async () => {
    const { channel } = fakeChannel(10, NOW - 3 * 3_600_000);
    expect(await fetchRecentMessages(channel, 500, NOW - 60 * 60_000)).toEqual([]);
  });
});

describe('formatDuration', () => {
  it.each([
    [1, '1 minute'],
    [30, '30 minutes'],
    [60, '1 hour'],
    [90, '90 minutes'],
    [120, '2 hours'],
    [1440, '24 hours'],
  ])('%i -> %s', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text);
  });
});

describe('/summarize options', () => {
  it('has a time option in minutes, 1 to 1440', () => {
    const time = (data.toJSON().options ?? []).find((o: any) => o.name === 'time') as any;
    expect(time).toMatchObject({ type: 4, min_value: 1, max_value: 1440, required: false });
  });
});
