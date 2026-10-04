import { cleanContent, type Guild, type GuildTextBasedChannel, type Message } from 'discord.js';
import { registerUsers } from '../discord/fetchMessages.js';
import { Pseudonymizer } from '../summary/anonymize.js';
import { splitHalves } from './score.js';

export interface CollectOptions {
  maxPerChannel: number;
  maxAgeDays: number;
}

export const DEFAULT_COLLECT: CollectOptions = {
  maxPerChannel: 1000,
  maxAgeDays: 90,
};

export interface SampleOptions {
  maxMessages: number;
  maxChars: number;
}

export const DEFAULT_SAMPLE: SampleOptions = {
  maxMessages: 400,
  // Two halves of about 20k characters each, matching the scoring input cap.
  maxChars: 40_000,
};

export const MIN_MESSAGES = 30;
export const MIN_CHARS = 1500;

/** userId -> channelId -> messages (oldest first). */
export type MessagesByUser = Map<string, Map<string, Message[]>>;

function isUsable(msg: Message): boolean {
  return !msg.author.bot && !msg.system && msg.content.trim().split(/\s+/).length >= 3;
}

/** Scans the given channels once and groups the requested users' messages by channel. */
export async function collectMessages(
  guild: Guild,
  userIds: Set<string>,
  channels: GuildTextBasedChannel[],
  options: Partial<CollectOptions> = {},
): Promise<MessagesByUser> {
  const opt = { ...DEFAULT_COLLECT, ...options };
  const cutoff = Date.now() - opt.maxAgeDays * 86_400_000;
  const byUser: MessagesByUser = new Map([...userIds].map((id) => [id, new Map()]));

  for (const channel of channels) {
    let before: string | undefined;
    let scanned = 0;
    while (scanned < opt.maxPerChannel) {
      const page = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!page || page.size === 0) break;
      let reachedCutoff = false;
      for (const msg of page.values()) {
        if (msg.createdTimestamp < cutoff) {
          reachedCutoff = true;
          break;
        }
        if (!userIds.has(msg.author.id) || !isUsable(msg)) continue;
        const perChannel = byUser.get(msg.author.id)!;
        if (!perChannel.has(channel.id)) perChannel.set(channel.id, []);
        perChannel.get(channel.id)!.push(msg);
      }
      scanned += page.size;
      before = page.last()?.id;
      if (reachedCutoff || page.size < 100) break;
    }
  }

  for (const perChannel of byUser.values()) {
    for (const msgs of perChannel.values()) msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }
  return byUser;
}

interface Timed {
  createdTimestamp: number;
  content: string;
}

/**
 * Takes messages round-robin across channels (newest first within each), so
 * one busy channel can't dominate. Stops at the message or character budget.
 * Returns the sample per channel, each oldest first.
 */
export function balancedSample<T extends Timed>(
  byChannel: Map<string, T[]>,
  options: Partial<SampleOptions> = {},
): Map<string, T[]> {
  const opt = { ...DEFAULT_SAMPLE, ...options };
  const queues = [...byChannel.entries()]
    .filter(([, msgs]) => msgs.length > 0)
    .map(([id, msgs]) => ({ id, msgs: [...msgs].sort((a, b) => b.createdTimestamp - a.createdTimestamp), next: 0 }));
  const picked = new Map<string, T[]>(queues.map((q) => [q.id, []]));

  let count = 0;
  let chars = 0;
  let progressed = true;
  while (progressed && count < opt.maxMessages) {
    progressed = false;
    for (const q of queues) {
      if (count >= opt.maxMessages) break;
      const msg = q.msgs[q.next];
      if (!msg) continue;
      if (chars + msg.content.length > opt.maxChars) {
        q.next = q.msgs.length; // this channel's next message doesn't fit; move on
        continue;
      }
      picked.get(q.id)!.push(msg);
      q.next++;
      count++;
      chars += msg.content.length;
      progressed = true;
    }
  }

  for (const [id, msgs] of picked) {
    if (msgs.length === 0) picked.delete(id);
    else msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }
  return picked;
}

/**
 * Splits each channel's messages into two alternating halves, so both halves
 * have the same mix of channels. Each half comes back in chronological order.
 */
export function stratifiedHalves<T extends Timed>(byChannel: Map<string, T[]>): [T[], T[]] {
  const a: T[] = [];
  const b: T[] = [];
  for (const msgs of byChannel.values()) {
    const [ha, hb] = splitHalves(msgs);
    a.push(...ha);
    b.push(...hb);
  }
  const byTime = (x: T, y: T) => x.createdTimestamp - y.createdTimestamp;
  return [a.sort(byTime), b.sort(byTime)];
}

/**
 * Message texts tagged with their channel, with mentions and known names
 * replaced by UserN aliases. `all` should include every message being
 * analyzed so names are recognized consistently.
 */
export function anonymizedTexts(messages: Message[], all: Message[] = messages): string[] {
  const pseudo = new Pseudonymizer();
  for (const m of all) registerUsers(m, pseudo);
  return messages.map((m) => {
    const name = 'name' in m.channel && m.channel.name ? m.channel.name : 'channel';
    return `[#${name}] ${cleanContent(pseudo.scrubText(m.content), m.channel)}`;
  });
}

export function countMessages(byChannel: Map<string, unknown[]>): number {
  let n = 0;
  for (const msgs of byChannel.values()) n += msgs.length;
  return n;
}

export function hasEnoughText(messages: Timed[]): boolean {
  return (
    messages.length >= MIN_MESSAGES &&
    messages.reduce((n, m) => n + m.content.length, 0) >= MIN_CHARS
  );
}

/**
 * Identifies the set of collected messages without storing any text: the
 * newest message ID plus the total count. A new message changes the ID; a
 * deleted (or aged-out) one changes the count. Used to tell whether a cached
 * profile or summary is still current.
 */
export function sourceKey(byChannel: Map<string, Array<{ id: string; createdTimestamp: number }>>): string {
  let newest: { id: string; createdTimestamp: number } | undefined;
  let count = 0;
  for (const msgs of byChannel.values()) {
    count += msgs.length;
    for (const m of msgs) {
      if (!newest || m.createdTimestamp > newest.createdTimestamp) newest = m;
    }
  }
  return `${newest?.id ?? 'none'}:${count}`;
}
