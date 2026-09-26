import Parser from 'rss-parser';

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  description: string;
  published?: Date;
}

// General top-news feeds from a spread of outlets. The LLM ranks across all of
// them, so a story covered by several outlets is more likely to be picked.
export const FEEDS: Array<{ source: string; url: string }> = [
  { source: 'BBC', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { source: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  { source: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { source: 'WSJ', url: 'https://feeds.content.dowjones.io/public/rss/RSSWorldNews' },
  { source: 'Fox News', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
  { source: 'ABC News', url: 'https://abcnews.go.com/abcnews/topstories' },
  { source: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/main' },
  { source: 'PBS NewsHour', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { source: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
];

const ITEMS_PER_FEED = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX = 200;

const FETCH_TIMEOUT_MS = 15_000;
const parser = new Parser();

async function fetchFeed(url: string) {
  // Fetch ourselves so the timeout actually aborts the request.
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PoliBot/0.1 (Discord news digest)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parser.parseString(await res.text());
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Keeps items from the last 24 hours (items without a date are kept), newest
 * first, capped per feed, with duplicate links and previously posted links removed.
 */
export function selectRecent(
  items: NewsItem[],
  now: Date,
  { perFeed = ITEMS_PER_FEED, exclude = new Set<string>() } = {},
): NewsItem[] {
  const seen = new Set<string>(exclude);
  const counts = new Map<string, number>();
  const sorted = [...items].sort(
    (a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0),
  );

  const out: NewsItem[] = [];
  for (const item of sorted) {
    if (!item.title || !item.link || seen.has(item.link)) continue;
    if (item.published && now.getTime() - item.published.getTime() > MAX_AGE_MS) continue;
    const n = counts.get(item.source) ?? 0;
    if (n >= perFeed) continue;
    counts.set(item.source, n + 1);
    seen.add(item.link);
    out.push(item);
  }
  return out;
}

/** Fetches all feeds in parallel. Feeds that fail are logged and skipped. */
export async function fetchHeadlines(
  now = new Date(),
  exclude = new Set<string>(),
): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async ({ source, url }) => {
      const feed = await fetchFeed(url);
      return feed.items.map(
        (it): NewsItem => ({
          source,
          title: stripHtml(it.title ?? ''),
          link: it.link ?? '',
          description: stripHtml(it.contentSnippet ?? it.content ?? it.summary ?? '').slice(
            0,
            DESCRIPTION_MAX,
          ),
          published: it.isoDate ? new Date(it.isoDate) : undefined,
        }),
      );
    }),
  );

  const items: NewsItem[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else console.warn(`Feed ${FEEDS[i].source} failed:`, r.reason?.message ?? r.reason);
  });
  return selectRecent(items, now, { exclude });
}
