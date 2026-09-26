import type { Collection, GuildTextBasedChannel, Message } from 'discord.js';
import type { TranscriptMessage } from '../summary/format.js';

// Discord returns at most 100 messages per request.
const PAGE_SIZE = 100;

/**
 * Fetches up to `count` of the most recent messages in the channel, paging
 * backwards, and returns them oldest-first.
 */
export async function fetchRecentMessages(
  channel: GuildTextBasedChannel,
  count: number,
): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;

  while (collected.length < count) {
    const limit = Math.min(PAGE_SIZE, count - collected.length);
    const page: Collection<string, Message> = await channel.messages.fetch({ limit, before });
    if (page.size === 0) break;

    // Pages come back newest-first.
    collected.push(...page.values());
    before = page.last()?.id;
    if (page.size < limit) break;
  }

  return collected.reverse();
}

export function toTranscriptMessage(msg: Message): TranscriptMessage {
  return {
    authorName: msg.member?.displayName ?? msg.author.displayName ?? msg.author.username,
    isBot: msg.author.bot,
    isSystem: msg.system,
    content: msg.cleanContent,
    createdAt: msg.createdAt,
    attachmentNames: [...msg.attachments.values()].map((a) => a.name),
    embedCount: msg.embeds.length,
  };
}
