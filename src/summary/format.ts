/** Minimal shape of a message needed to build a transcript. */
export interface TranscriptMessage {
  authorName: string;
  isBot: boolean;
  isSystem: boolean;
  content: string;
  createdAt: Date;
  attachmentNames: string[];
  embedCount: number;
}

export interface FormatOptions {
  includeBots?: boolean;
}

function timestamp(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${date.toISOString().slice(0, 10)} ${hh}:${mm}`;
}

/**
 * Turns messages (in chronological order) into transcript lines like
 * `[2026-09-26 14:05] alice: hello [attachment: cat.png]`.
 * Skips system messages, messages with nothing to show, and bots unless asked.
 */
export function formatMessages(
  messages: TranscriptMessage[],
  { includeBots = false }: FormatOptions = {},
): string[] {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.isSystem) continue;
    if (msg.isBot && !includeBots) continue;

    const parts: string[] = [];
    const text = msg.content.replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
    for (const name of msg.attachmentNames) parts.push(`[attachment: ${name}]`);
    if (msg.embedCount > 0) parts.push('[embed]');
    if (parts.length === 0) continue;

    lines.push(`[${timestamp(msg.createdAt)}] ${msg.authorName}: ${parts.join(' ')}`);
  }
  return lines;
}

/**
 * Keeps the most recent lines whose total length (joined by newlines) fits in
 * maxChars. Oldest lines are dropped first.
 */
export function truncateToBudget(
  lines: string[],
  maxChars: number,
): { lines: string[]; dropped: number } {
  let total = 0;
  let start = lines.length;
  while (start > 0) {
    const next = lines[start - 1].length + (start === lines.length ? 0 : 1);
    if (total + next > maxChars) break;
    total += next;
    start--;
  }
  return { lines: lines.slice(start), dropped: start };
}

/**
 * Splits text into chunks no longer than maxLen, preferring to break on
 * newlines, then spaces, then hard-cutting.
 */
export function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** "1 minute", "30 minutes", "1 hour", "90 minutes", "2 hours". */
export function formatDuration(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
