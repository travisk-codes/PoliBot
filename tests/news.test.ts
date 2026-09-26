import { describe, expect, it } from 'vitest';
import { selectRecent, type NewsItem } from '../src/news/feeds.js';
import { buildPrompt, fallbackPicks, parsePicks } from '../src/news/pick.js';
import { buildNewsEmbed } from '../src/news/post.js';
import { formatTime12h, isDue, localDateTime, parseTime } from '../src/news/time.js';

const NY = 'America/New_York';

function item(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    source: 'BBC',
    title: 'Headline',
    link: 'https://example.com/a',
    description: 'Description',
    published: new Date('2026-09-26T12:00:00Z'),
    ...overrides,
  };
}

describe('time helpers', () => {
  it('converts to Eastern local date and time, including across midnight UTC', () => {
    // 03:30 UTC on the 27th is 23:30 EDT on the 26th.
    expect(localDateTime(new Date('2026-09-27T03:30:00Z'), NY)).toEqual({
      date: '2026-09-26',
      time: '23:30',
    });
    // Winter (EST, UTC-5).
    expect(localDateTime(new Date('2026-01-15T13:05:00Z'), NY).time).toBe('08:05');
  });

  it('parses and normalizes times', () => {
    expect(parseTime('8:00')).toBe('08:00');
    expect(parseTime(' 17:30 ')).toBe('17:30');
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('8am')).toBeNull();
    expect(parseTime('08:60')).toBeNull();
  });

  it('formats 12-hour times', () => {
    expect(formatTime12h('00:05')).toBe('12:05 AM');
    expect(formatTime12h('08:00')).toBe('8:00 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('17:30')).toBe('5:30 PM');
  });

  it('is due once the time is reached on a day not yet posted', () => {
    const at = (iso: string) => new Date(iso);
    const cfg = { time: '08:00' };
    expect(isDue(at('2026-09-26T11:59:00Z'), cfg, NY)).toBe(false); // 07:59 EDT
    expect(isDue(at('2026-09-26T12:00:00Z'), cfg, NY)).toBe(true); // 08:00 EDT
    expect(isDue(at('2026-09-26T20:00:00Z'), cfg, NY)).toBe(true); // catch up later that day
    expect(isDue(at('2026-09-26T20:00:00Z'), { ...cfg, lastPostedDate: '2026-09-26' }, NY)).toBe(
      false,
    );
    expect(isDue(at('2026-09-27T12:00:00Z'), { ...cfg, lastPostedDate: '2026-09-26' }, NY)).toBe(
      true,
    );
  });
});

describe('selectRecent', () => {
  const now = new Date('2026-09-26T20:00:00Z');

  it('drops old items, duplicates, and excluded links, newest first', () => {
    const out = selectRecent(
      [
        item({ link: 'a', published: new Date('2026-09-26T10:00:00Z') }),
        item({ link: 'b', published: new Date('2026-09-26T18:00:00Z') }),
        item({ link: 'b', source: 'NPR' }),
        item({ link: 'old', published: new Date('2026-09-25T10:00:00Z') }),
        item({ link: 'seen' }),
        item({ link: 'undated', published: undefined }),
      ],
      now,
      { exclude: new Set(['seen']) },
    );
    expect(out.map((i) => i.link)).toEqual(['b', 'a', 'undated']);
  });

  it('caps items per feed', () => {
    const items = Array.from({ length: 5 }, (_, i) => item({ link: `l${i}` }));
    expect(selectRecent(items, now, { perFeed: 2 })).toHaveLength(2);
  });
});

describe('parsePicks', () => {
  const items = [
    item({ source: 'BBC', link: 'https://bbc/1' }),
    item({ source: 'NPR', link: 'https://npr/1' }),
    item({ source: 'BBC', link: 'https://bbc/2' }),
  ];

  it('parses JSON wrapped in prose or code fences and maps item numbers to links', () => {
    const reply =
      'Here you go:\n```json\n' +
      JSON.stringify({
        stories: [
          { headline: 'A', summary: 'Sum A', items: [1, 2, 3] },
          { headline: 'B', summary: 'Sum B', items: [3] },
        ],
      }) +
      '\n```';
    expect(parsePicks(reply, items)).toEqual([
      {
        headline: 'A',
        summary: 'Sum A',
        // One link per outlet: the second BBC item is skipped.
        links: [
          { source: 'BBC', url: 'https://bbc/1' },
          { source: 'NPR', url: 'https://npr/1' },
        ],
      },
      { headline: 'B', summary: 'Sum B', links: [{ source: 'BBC', url: 'https://bbc/2' }] },
    ]);
  });

  it('skips stories with invalid item numbers and caps at three', () => {
    const reply = JSON.stringify({
      stories: [
        { headline: 'bad', summary: '', items: [99] },
        { headline: '1', summary: '', items: [1] },
        { headline: '2', summary: '', items: [2] },
        { headline: '3', summary: '', items: [3] },
        { headline: '4', summary: '', items: [1] },
      ],
    });
    expect(parsePicks(reply, items)?.map((s) => s.headline)).toEqual(['1', '2', '3']);
  });

  it('returns null for unusable replies', () => {
    expect(parsePicks('no json here', items)).toBeNull();
    expect(parsePicks('{not valid}', items)).toBeNull();
    expect(parsePicks('{"stories": []}', items)).toBeNull();
  });
});

describe('fallbackPicks and prompt', () => {
  it('takes one item per outlet', () => {
    const picks = fallbackPicks([
      item({ source: 'BBC', title: 'b1' }),
      item({ source: 'BBC', title: 'b2' }),
      item({ source: 'NPR', title: 'n1' }),
      item({ source: 'NYT', title: 'y1' }),
      item({ source: 'WSJ', title: 'w1' }),
    ]);
    expect(picks.map((p) => p.headline)).toEqual(['b1', 'n1', 'y1']);
  });

  it('numbers items and lists recent headlines', () => {
    const prompt = buildPrompt([item({ title: 'T', description: 'D' })], ['Old story']);
    expect(prompt).toContain('[1] (BBC) T - D');
    expect(prompt).toContain('Recently posted:\n- Old story');
  });
});

describe('buildNewsEmbed', () => {
  it('fits Discord embed field limits', () => {
    const embed = buildNewsEmbed(
      [
        {
          headline: 'H'.repeat(400),
          summary: 'S'.repeat(2000),
          links: [{ source: 'BBC', url: 'https://bbc.co.uk/x' }],
        },
      ],
      new Date('2026-09-26T12:00:00Z'),
    ).toJSON();
    const field = embed.fields![0];
    expect(field.name.length).toBeLessThanOrEqual(256);
    expect(field.value.length).toBeLessThanOrEqual(1024);
    expect(field.value).toContain('[BBC](https://bbc.co.uk/x)');
    expect(embed.title).toBe('Top stories for Saturday, September 26');
  });
});
