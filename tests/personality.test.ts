import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPersonalitySvg, formatValue } from '../src/personality/chart.js';
import { averageScores, buildScoringInput, parseScores, splitHalves } from '../src/personality/score.js';
import { pearson, sd, selectTraits, spearmanBrown } from '../src/personality/select.js';
import { PersonalityStore, SAMPLE_VERSION } from '../src/personality/store.js';
import { DEFAULT_DIMENSIONS, TRAIT_IDS, TRAITS } from '../src/personality/traits.js';

describe('traits', () => {
  it('has 16 unique candidates and a valid default set', () => {
    expect(TRAITS).toHaveLength(16);
    expect(new Set(TRAIT_IDS).size).toBe(16);
    for (const id of DEFAULT_DIMENSIONS) expect(TRAIT_IDS).toContain(id);
  });
});

describe('statistics', () => {
  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 2, 3, 4], [1, 3, 2, 4])).toBeCloseTo(0.8);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it('applies Spearman-Brown and standard deviation', () => {
    expect(spearmanBrown(0.5)).toBeCloseTo(2 / 3);
    expect(spearmanBrown(1)).toBe(1);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });
});

describe('selectTraits', () => {
  // Deterministic pseudo-random noise.
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  function members(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const trueOpen = -0.8 + (1.6 * i) / (n - 1); // wide spread
      const trueAnalytical = ((i * 7) % n) / n - 0.5; // wide spread, unrelated to openness
      const half = () => ({
        openness: trueOpen + rnd() * 0.05, // reliable, spread out
        curiosity: trueOpen + rnd() * 0.05, // duplicate of openness
        analytical: trueAnalytical + rnd() * 0.05, // reliable, independent
        noise: rnd(), // halves disagree
        flat: 0.3 + rnd() * 0.01, // reliable-ish but everyone the same
      });
      return { a: half(), b: half() };
    });
  }

  it('keeps reliable, varied, non-redundant traits and explains the rest', () => {
    const ids = ['openness', 'curiosity', 'analytical', 'noise', 'flat'];
    const sel = selectTraits(members(12), ids);
    expect(sel.tested).toBe(true);
    expect(sel.chosen).toContain('analytical');
    expect(sel.chosen.filter((id) => id === 'openness' || id === 'curiosity')).toHaveLength(1);

    const status = Object.fromEntries(sel.results.map((r) => [r.id, r.status]));
    expect(status.noise).toBe('unreliable');
    expect(status.flat).toMatch(/flat|unreliable/);
    expect([status.openness, status.curiosity].sort()).toEqual(['kept', 'redundant']);
  });

  it('keeps catalog order for display, not ranking order', () => {
    const sel = selectTraits(members(12), ['analytical', 'openness']);
    expect(sel.chosen).toEqual(['analytical', 'openness']);
  });

  it('falls back to the default set with too few members', () => {
    const sel = selectTraits(members(4), ['openness']);
    expect(sel.tested).toBe(false);
    expect(sel.chosen).toEqual(DEFAULT_DIMENSIONS);
  });

  it('respects the dimension limit', () => {
    const sel = selectTraits(members(12), ['openness', 'analytical'], { maxDimensions: 1 });
    expect(sel.chosen).toHaveLength(1);
    expect(sel.results.some((r) => r.status === 'over limit')).toBe(true);
  });
});

describe('scoring helpers', () => {
  it('parses and clamps scores, ignoring unknown ids and junk', () => {
    const reply = 'Sure:\n```json\n{"scores":{"openness":0.4,"agreeableness":-3,"certainty":"0.2","bogus":1,"tone":"n/a"}}\n```';
    expect(parseScores(reply)).toEqual({ openness: 0.4, agreeableness: -1, certainty: 0.2 });
  });

  it('returns null for unusable replies', () => {
    expect(parseScores('no json')).toBeNull();
    expect(parseScores('{"scores": {}}')).toBeNull();
    expect(parseScores('{broken')).toBeNull();
  });

  it('splits into interleaved halves', () => {
    expect(splitHalves([1, 2, 3, 4, 5])).toEqual([[1, 3, 5], [2, 4]]);
  });

  it('averages halves', () => {
    expect(averageScores({ a: 0.2, b: 1 }, { a: 0.4 })).toEqual({ a: 0.30000000000000004, b: 1 });
  });

  it('keeps the most recent messages within the budget, oldest first', () => {
    const input = buildScoringInput(['old message', 'middle one', 'newest'], 30);
    expect(input).toContain('- middle one\n- newest');
    expect(input).not.toContain('old message');
  });
});

describe('PersonalityStore', () => {
  it('handles opt-in, profiles, dimensions, and opt-out cleanup', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pers-')), 'p.json');
    const store = new PersonalityStore(file);
    const profile = { scores: { openness: 0.5 }, halfA: {}, halfB: {}, messageCount: 40, updatedAt: 'x' };

    store.setProfile('g', 'u1', profile);
    expect(store.getProfile('g', 'u1')).toBeUndefined(); // not opted in: not stored

    expect(store.optIn('g', 'u1')).toBe(true);
    expect(store.optIn('g', 'u1')).toBe(false);
    store.setProfile('g', 'u1', profile);
    expect(store.getProfile('g', 'u1')).toEqual({ ...profile, sampleVersion: SAMPLE_VERSION });
    expect(store.dimensions('g').ids).toEqual(DEFAULT_DIMENSIONS);
    store.setDimensions('g', ['openness']);

    // Persists across instances.
    const reloaded = new PersonalityStore(file);
    expect(reloaded.optedInUsers('g')).toEqual(['u1']);
    expect(reloaded.dimensions('g').ids).toEqual(['openness']);

    expect(reloaded.optOut('g', 'u1')).toBe(true);
    expect(reloaded.getProfile('g', 'u1')).toBeUndefined();
    expect(readFileSync(file, 'utf8')).not.toContain('"u1"');
  });
});

describe('chart', () => {
  it('formats values with signs', () => {
    expect(formatValue(0.4199)).toBe('+0.42');
    expect(formatValue(-1)).toBe('−1.00');
    expect(formatValue(0.001)).toBe('±0.00');
  });

  it('draws one bar per nonzero row, clamps, and escapes text', () => {
    const { svg, height } = buildPersonalitySvg({
      title: 'Personality · <b>&me',
      subtitle: 's',
      footer: 'f',
      rows: [
        { name: 'A', low: 'lo', high: 'hi', value: 2 },
        { name: 'B', low: 'lo', high: 'hi', value: -1 },
        { name: 'C', low: 'lo', high: 'hi', value: 0 },
      ],
    });
    expect(height).toBeGreaterThan(0);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('+1.00');
    expect(svg).not.toContain('<b>');
    // Bars stay inside the track (x 250..750).
    for (const m of svg.matchAll(/<path d="M([\d.]+),[\d.]+ H([\d.]+)/g)) {
      for (const x of [Number(m[1]), Number(m[2])]) {
        expect(x).toBeGreaterThanOrEqual(250);
        expect(x).toBeLessThanOrEqual(750);
      }
    }
  });
});
