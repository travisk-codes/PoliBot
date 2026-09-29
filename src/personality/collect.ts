import {
  cleanContent,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { registerUsers } from '../discord/fetchMessages.js';
import { Pseudonymizer } from '../summary/anonymize.js';

export interface CollectOptions {
  maxPerChannel: number;
  maxAgeDays: number;
  maxPerUser: number;
}

export const DEFAULT_COLLECT: CollectOptions = {
  maxPerChannel: 1000,
  maxAgeDays: 90,
  maxPerUser: 400,
};

export const MIN_MESSAGES = 30;
export const MIN_CHARS = 1500;

function isUsable(msg: Message): boolean {
  return !msg.author.bot && !msg.system && msg.content.trim().split(/\s+/).length >= 3;
}

/**
 * Scans every readable text channel once and returns each requested user's
 * messages (oldest first, most recent `maxPerUser` kept).
 */
export async function collectMessages(
  guild: Guild,
  userIds: Set<string>,
  options: Partial<CollectOptions> = {},
): Promise<Map<string, Message[]>> {
  const opt = { ...DEFAULT_COLLECT, ...options };
  const cutoff = Date.now() - opt.maxAgeDays * 86_400_000;
  const me = guild.members.me;
  const byUser = new Map<string, Message[]>([...userIds].map((id) => [id, []]));

  const channels = [...guild.channels.cache.values()].filter(
    (c): c is GuildTextBasedChannel =>
      c.isTextBased() &&
      !c.isThread() &&
      !!me &&
      c.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );

  for (const channel of channels) {
    let before: string | undefined;
    let scanned = 0;
    while (scanned < opt.maxPerChannel) {
      const page = await channel.messages
        .fetch({ limit: 100, before })
        .catch(() => null);
      if (!page || page.size === 0) break;
      let reachedCutoff = false;
      for (const msg of page.values()) {
        if (msg.createdTimestamp < cutoff) {
          reachedCutoff = true;
          break;
        }
        if (userIds.has(msg.author.id) && isUsable(msg)) byUser.get(msg.author.id)!.push(msg);
      }
      scanned += page.size;
      before = page.last()?.id;
      if (reachedCutoff || page.size < 100) break;
    }
  }

  for (const [id, msgs] of byUser) {
    msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    byUser.set(id, msgs.slice(-opt.maxPerUser));
  }
  return byUser;
}

/** Message texts with mentions and known names replaced by UserN aliases. */
export function anonymizedTexts(messages: Message[]): string[] {
  const pseudo = new Pseudonymizer();
  for (const m of messages) registerUsers(m, pseudo);
  return messages.map((m) => cleanContent(pseudo.scrubText(m.content), m.channel));
}

export function hasEnoughText(texts: string[]): boolean {
  return texts.length >= MIN_MESSAGES && texts.reduce((n, t) => n + t.length, 0) >= MIN_CHARS;
}
