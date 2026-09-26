import { describe, expect, it } from 'vitest';
import { Pseudonymizer } from '../src/summary/anonymize.js';
import { formatMessages, type TranscriptMessage } from '../src/summary/format.js';

describe('Pseudonymizer', () => {
  it('assigns stable aliases in order of first appearance', () => {
    const p = new Pseudonymizer();
    expect(p.alias('1', ['Alice'])).toBe('User1');
    expect(p.alias('2', ['Bob'])).toBe('User2');
    expect(p.alias('1')).toBe('User1');
  });

  it('replaces user mentions, including unknown users', () => {
    const p = new Pseudonymizer();
    p.alias('111', ['Alice']);
    expect(p.scrubText('hi <@111> and <@!111> and <@999>')).toBe(
      'hi @User1 and @User1 and @User2',
    );
  });

  it('replaces plain-text names as whole words, case-insensitively', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['Alice', 'alice_w', 'alice.w']);
    expect(p.scrubText('ALICE said alice_w and alice.w, not malice or alices')).toBe(
      'User1 said User1 and User1, not malice or alices',
    );
  });

  it('prefers longer names so they are not partially replaced', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['Bob']);
    p.alias('2', ['Bob Smith']);
    expect(p.scrubText('Bob Smith and Bob')).toBe('User2 and User1');
  });

  it('does not scrub very short names from plain text', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['Al']);
    expect(p.scrubText('Al is here, <@1>')).toBe('Al is here, @User1');
  });

  it('escapes regex characters in names', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['c++dev (he/him)']);
    expect(p.scrubText('ask c++dev (he/him) about it')).toBe('ask User1 about it');
  });

  it('restores the first name given for each alias', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['Alice', 'alice_w']);
    p.alias('2', [undefined, 'Bob']);
    for (let i = 3; i <= 10; i++) p.alias(String(i), [`Person${i}`]);
    expect(p.restore('User1 agreed with @User2; User10 and User99 did not.')).toBe(
      'Alice agreed with @Bob; Person10 and User99 did not.',
    );
  });

  it('keeps real names out of the formatted transcript', () => {
    const p = new Pseudonymizer();
    p.alias('1', ['Alice Wong', 'alicew']);
    p.alias('2', ['Bob', 'bobby42']);
    const msg = (authorId: string, content: string, attachmentNames: string[] = []): TranscriptMessage => ({
      authorName: p.alias(authorId),
      isBot: false,
      isSystem: false,
      content: p.scrubText(content),
      createdAt: new Date('2026-09-26T14:05:00Z'),
      attachmentNames: attachmentNames.map((n) => p.scrubText(n)),
      embedCount: 0,
    });

    const out = formatMessages([
      msg('1', 'hey <@2>, did bobby42 see this?'),
      msg('2', 'yes Alice Wong, I did', ['alicew_notes.txt']),
    ]).join('\n');

    expect(out).toBe(
      [
        '[2026-09-26 14:05] User1: hey @User2, did User2 see this?',
        '[2026-09-26 14:05] User2: yes User1, I did [attachment: User1_notes.txt]',
      ].join('\n'),
    );
    for (const name of ['Alice Wong', 'alicew', 'Bob', 'bobby42']) {
      expect(out.toLowerCase()).not.toContain(name.toLowerCase());
    }
  });
});
