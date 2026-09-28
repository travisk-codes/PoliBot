export const NEWS_TIMEZONE = process.env.NEWS_TIMEZONE || 'America/New_York';

/** Returns the local date ("YYYY-MM-DD") and time ("HH:MM") of `now` in `timeZone`. */
export function localDateTime(now: Date, timeZone = NEWS_TIMEZONE): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Accepts "8:00", "08:00", "20:30"; returns normalized "HH:MM" or null. */
export function parseTime(input: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** A post is due once the local time reaches `time` on a day not yet posted. */
export function isDue(
  now: Date,
  config: { time: string; lastPostedDate?: string },
  timeZone = NEWS_TIMEZONE,
): boolean {
  const local = localDateTime(now, timeZone);
  return local.time >= config.time && config.lastPostedDate !== local.date;
}

/** Formats "HH:MM" as e.g. "8:00 AM". */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}
