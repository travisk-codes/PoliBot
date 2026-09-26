import { describe, expect, it } from 'vitest';
import {
  chunkText,
  formatMessages,
  truncateToBudget,
  type TranscriptMessage,
} from '../src/summary/format.js';

function msg(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    authorName: 'alice',
    isBot: false,
    isSystem: false,
    content: 'hello',
    createdAt: new Date('2026-09-26T14:05:00Z'),
    attachmentNames: [],
    embedCount: 0,
    ...overrides,
  };
}

describe('formatMessages', () => {
  it('formats author, timestamp, and content', () => {
    expect(formatMessages([msg()])).toEqual(['[2026-09-26 14:05] alice: hello']);
  });

  it('collapses whitespace and adds attachment/embed placeholders', () => {
    const lines = formatMessages([
      msg({ content: 'look\n\nat   this', attachmentNames: ['cat.png'], embedCount: 1 }),
    ]);
    expect(lines).toEqual(['[2026-09-26 14:05] alice: look at this [attachment: cat.png] [embed]']);
  });

  it('skips system, empty, and bot messages by default', () => {
    const lines = formatMessages([
      msg({ isSystem: true }),
      msg({ content: '   ' }),
      msg({ authorName: 'bot', isBot: true }),
      msg({ authorName: 'bob', content: 'hi' }),
    ]);
    expect(lines).toEqual(['[2026-09-26 14:05] bob: hi']);
  });

  it('includes bots when asked', () => {
    const lines = formatMessages([msg({ authorName: 'bot', isBot: true })], { includeBots: true });
    expect(lines).toHaveLength(1);
  });
});

describe('truncateToBudget', () => {
  it('keeps everything when it fits', () => {
    expect(truncateToBudget(['aa', 'bb'], 5)).toEqual({ lines: ['aa', 'bb'], dropped: 0 });
  });

  it('drops oldest lines first', () => {
    // 'bb\ncc' = 5 chars; adding 'aa\n' would make 8.
    expect(truncateToBudget(['aa', 'bb', 'cc'], 6)).toEqual({ lines: ['bb', 'cc'], dropped: 1 });
  });

  it('returns nothing if even the newest line is too long', () => {
    expect(truncateToBudget(['aaaaa'], 3)).toEqual({ lines: [], dropped: 1 });
  });
});

describe('chunkText', () => {
  it('returns a single chunk when short enough', () => {
    expect(chunkText('hello', 10)).toEqual(['hello']);
  });

  it('prefers breaking on newlines', () => {
    expect(chunkText('aaaa\nbbbb\ncccc', 10)).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  it('falls back to spaces, then hard cuts', () => {
    expect(chunkText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(chunkText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never produces chunks over the limit', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(i % 37)}`).join('\n');
    for (const chunk of chunkText(text, 100)) expect(chunk.length).toBeLessThanOrEqual(100);
  });
});
