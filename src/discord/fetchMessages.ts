import { cleanContent, type Collection, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Pseudonymizer } from '../summary/anonymize.js';
import type { TranscriptMessage } from '../summary/format.js';

// Discord returns at most 100 messages per request.
const PAGE_SIZE = 100;

/**
 * Fetches up to `count` of the most recent messages in the channel, paging
 * backwards, and returns them oldest-first. With `since` (a timestamp in ms),
 * only messages at or after it are kept, and paging stops once older
 * messages are reached.
 */
export async function fetchRecentMessages(
  channel: Pick<GuildTextBasedChannel, 'messages'>,
  count: number,
  since?: number,
): Promise<Message[]> {
  const collected: Message[] = [];
  let before: string | undefined;

  while (collected.length < count) {
    const limit = Math.min(PAGE_SIZE, count - collected.length);
    const page: Collection<string, Message> = await channel.messages.fetch({ limit, before });
    if (page.size === 0) break;

    // Pages come back newest-first.
    let reachedSince = false;
    for (const msg of page.values()) {
      if (since !== undefined && msg.createdTimestamp < since) {
        reachedSince = true;
        break;
      }
      collected.push(msg);
    }
    before = page.last()?.id;
    if (reachedSince || page.size < limit) break;
  }

  return collected.reverse();
}

/**
 * Registers the author and every mentioned user of a message with the
 * pseudonymizer. Call this for all messages before `toTranscriptMessage`, so
 * plain-text name scrubbing knows every name in the conversation.
 */
export function registerUsers(msg: Message, pseudo: Pseudonymizer): void {
  pseudo.alias(msg.author.id, [
    msg.member?.displayName,
    msg.author.globalName,
    msg.author.username,
  ]);
  for (const user of msg.mentions.users.values()) {
    pseudo.alias(user.id, [
      msg.mentions.members?.get(user.id)?.displayName,
      user.globalName,
      user.username,
    ]);
  }
}

export function toTranscriptMessage(msg: Message, pseudo: Pseudonymizer): TranscriptMessage {
  return {
    authorName: pseudo.alias(msg.author.id),
    isBot: msg.author.bot,
    isSystem: msg.system,
    // User mentions are replaced first, so cleanContent only resolves the
    // remaining role/channel/emoji mentions and never inserts a real name.
    content: cleanContent(pseudo.scrubText(msg.content), msg.channel),
    createdAt: msg.createdAt,
    attachmentNames: [...msg.attachments.values()].map((a) => pseudo.scrubText(a.name)),
    embedCount: msg.embeds.length,
  };
}
