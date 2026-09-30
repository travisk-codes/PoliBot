import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ineligibleReason, resolveEligible, type ChannelInfo } from '../src/personality/channels.js';
import { balancedSample, hasEnoughText, stratifiedHalves } from '../src/personality/collect.js';
import { buildScoringInput } from '../src/personality/score.js';
import { PersonalityStore, SAMPLE_VERSION } from '../src/personality/store.js';

const ch = (id: string, isPublic: boolean, botCanRead = true): ChannelInfo => ({ id, name: id, isPublic, botCanRead });

describe('channel eligibility', () => {
  const channels = [ch('pub', true), ch('priv', false), ch('mods', false), ch('memes', true), ch('locked', true, false)];

  it('defaults to public channels the bot can read', () => {
    expect(resolveEligible(channels, { excluded: [], included: [] }).map((c) => c.id)).toEqual(['pub', 'memes']);
  });

  it('applies admin exclusions and inclusions', () => {
    const ids = resolveEligible(channels, { excluded: ['memes'], included: ['priv', 'locked'] }).map((c) => c.id);
    // 'locked' stays out: included, but the bot can't read it.
    expect(ids).toEqual(['pub', 'priv']);
  });

  it('explains why a channel is not eligible', () => {
    const none = { excluded: [], included: [] };
    expect(ineligibleReason(ch('pub', true), none)).toBeNull();
    expect(ineligibleReason(undefined, none)).toMatch(/isn't a text channel/);
    expect(ineligibleReason(ch('locked', true, false), none)).toMatch(/can't read/);
    expect(ineligibleReason(ch('memes', true), { excluded: ['memes'], included: [] })).toMatch(/excluded/);
    expect(ineligibleReason(ch('priv', false), none)).toMatch(/isn't visible to everyone/);
    expect(ineligibleReason(ch('priv', false), { excluded: [], included: ['priv'] })).toBeNull();
  });
});

function msgs(channel: string, count: number, start = 0, length = 20) {
  return Array.from({ length: count }, (_, i) => ({
    channel,
    createdTimestamp: start + i,
    content: 'x'.repeat(length),
  }));
}

describe('balancedSample', () => {
  it('stops one busy channel from dominating', () => {
    const byChannel = new Map([
      ['busy', msgs('busy', 500, 1000)],
      ['quiet', msgs('quiet', 30, 0)],
      ['mid', msgs('mid', 80, 500)],
    ]);
    const sample = balancedSample(byChannel, { maxMessages: 150, maxChars: 1e9 });
    expect(sample.get('quiet')).toHaveLength(30); // all of the quiet channel
    expect(sample.get('mid')).toHaveLength(60);
    expect(sample.get('busy')).toHaveLength(60);
  });

  it('takes the newest messages per channel, returned oldest first', () => {
    const sample = balancedSample(new Map([['a', msgs('a', 10)]]), { maxMessages: 3, maxChars: 1e9 });
    expect(sample.get('a')!.map((m) => m.createdTimestamp)).toEqual([7, 8, 9]);
  });

  it('respects the character budget', () => {
    const byChannel = new Map([
      ['a', msgs('a', 50, 0, 100)],
      ['b', msgs('b', 50, 0, 100)],
    ]);
    const sample = balancedSample(byChannel, { maxMessages: 1000, maxChars: 1000 });
    const total = [...sample.values()].flat().reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(1000);
    expect(sample.get('a')).toHaveLength(5);
    expect(sample.get('b')).toHaveLength(5);
  });

  it('drops channels with nothing to contribute', () => {
    const sample = balancedSample(new Map([['a', msgs('a', 3)], ['empty', []]]));
    expect([...sample.keys()]).toEqual(['a']);
  });
});

describe('stratifiedHalves', () => {
  it('gives both halves the same channel mix, without losing or duplicating messages', () => {
    const byChannel = new Map([
      ['a', msgs('a', 10, 0)],
      ['b', msgs('b', 4, 100)],
    ]);
    const [h1, h2] = stratifiedHalves(byChannel);
    const count = (h: typeof h1, c: string) => h.filter((m) => m.channel === c).length;
    expect([count(h1, 'a'), count(h2, 'a')]).toEqual([5, 5]);
    expect([count(h1, 'b'), count(h2, 'b')]).toEqual([2, 2]);
    expect(new Set([...h1, ...h2]).size).toBe(14);
    // Chronological within each half.
    expect(h1.map((m) => m.createdTimestamp)).toEqual([...h1.map((m) => m.createdTimestamp)].sort((x, y) => x - y));
  });
});

describe('minimum data', () => {
  it('needs 30 messages and 1,500 characters', () => {
    expect(hasEnoughText(msgs('a', 30, 0, 50))).toBe(true);
    expect(hasEnoughText(msgs('a', 29, 0, 100))).toBe(false);
    expect(hasEnoughText(msgs('a', 40, 0, 10))).toBe(false);
  });
});

describe('scoring input', () => {
  it('keeps channel tags', () => {
    expect(buildScoringInput(['[#debate] hello there friend'])).toContain('- [#debate] hello there friend');
  });
});

describe('PersonalityStore channels', () => {
  const profile = { scores: { openness: 0.5 }, halfA: {}, halfB: {}, messageCount: 40, updatedAt: 'x' };
  const newStore = () => new PersonalityStore(join(mkdtempSync(join(tmpdir(), 'pers-')), 'p.json'));

  it('include and exclude override each other, reset clears both', () => {
    const store = newStore();
    store.excludeChannel('g', 'c1');
    expect(store.getChannelSettings('g')).toEqual({ excluded: ['c1'], included: [] });
    store.includeChannel('g', 'c1');
    expect(store.getChannelSettings('g')).toEqual({ excluded: [], included: ['c1'] });
    store.includeChannel('g', 'c1');
    expect(store.getChannelSettings('g').included).toEqual(['c1']);
    store.resetChannel('g', 'c1');
    expect(store.getChannelSettings('g')).toEqual({ excluded: [], included: [] });
  });

  it('clears cached profiles when channel settings change', () => {
    const store = newStore();
    store.optIn('g', 'u');
    store.setProfile('g', 'u', profile);
    store.setChannelProfile('g', 'u', 'c1', profile);
    expect(store.getProfile('g', 'u')).toBeDefined();
    store.excludeChannel('g', 'c2');
    expect(store.getProfile('g', 'u')).toBeUndefined();
    expect(store.getChannelProfile('g', 'u', 'c1')).toBeUndefined();
    expect(store.isOptedIn('g', 'u')).toBe(true);
  });

  it('keeps per-channel profiles separate and deletes them on opt-out', () => {
    const store = newStore();
    store.setChannelProfile('g', 'u', 'c1', profile);
    expect(store.getChannelProfile('g', 'u', 'c1')).toBeUndefined(); // not opted in
    store.optIn('g', 'u');
    store.setChannelProfile('g', 'u', 'c1', profile);
    expect(store.getChannelProfile('g', 'u', 'c1')?.sampleVersion).toBe(SAMPLE_VERSION);
    expect(store.getChannelProfile('g', 'u', 'c2')).toBeUndefined();
    expect(store.getProfile('g', 'u')).toBeUndefined();
    store.optOut('g', 'u');
    store.optIn('g', 'u');
    expect(store.getChannelProfile('g', 'u', 'c1')).toBeUndefined();
  });

  it('ignores profiles cached before this change', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pers-')), 'p.json');
    writeFileSync(
      file,
      JSON.stringify({ g: { optedIn: { u: 'x' }, profiles: { u: profile } } }),
    );
    const store = new PersonalityStore(file);
    expect(store.getProfile('g', 'u')).toBeUndefined();
    // Purged from the file on the next save, while the opt-in survives.
    store.optIn('g', 'other');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.g.profiles).toEqual({});
    expect(Object.keys(saved.g.optedIn).sort()).toEqual(['other', 'u']);
  });
});
