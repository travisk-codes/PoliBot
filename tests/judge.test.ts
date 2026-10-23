import { describe, expect, it } from 'vitest';
import { data } from '../src/commands/judge.js';
import { buildJudgmentEmbed, headline, parseJudgment, type Judgment } from '../src/judge/judge.js';

const known = new Set(['User1', 'User2', 'User3']);
const names: Record<string, string> = { User1: 'Alice', User2: 'Bob', User3: 'Cara' };
const restore = (s: string) => s.replace(/\bUser\d+\b/g, (a) => names[a] ?? a);

const reply = {
  topic: 'Minimum wage and jobs',
  participants: [
    { user: 'User1', position: 'Raising it costs jobs', evidence: 'Linked a CBO report', strengths: 'Cites data', weaknesses: 'Ignores User2 point', score: 8 },
    { user: 'User2', position: 'Effects are small', evidence: 'None', strengths: 'Clear', weaknesses: 'Unsupported', score: 4 },
  ],
  facts: [{ question: 'Does it reduce employment?', assessment: 'User1 cited a report.', favors: 'User1' }],
  values: [{ question: 'Is it worth it?', sides: 'User1 prioritizes jobs; User2 wages.' }],
  verdict: { kind: 'evidence', leader: 'User1', summary: 'User1 backed claims with a source; User2 did not.' },
};

describe('parseJudgment', () => {
  it('parses JSON wrapped in prose or code fences', () => {
    const j = parseJudgment('Here:\n```json\n' + JSON.stringify(reply) + '\n```', known);
    expect(j?.topic).toBe('Minimum wage and jobs');
    expect(j?.participants.map((p) => p.user)).toEqual(['User1', 'User2']);
    expect(j?.verdict).toMatchObject({ kind: 'evidence', leader: 'User1' });
  });

  it('drops unknown participants and clamps scores', () => {
    const j = parseJudgment(
      JSON.stringify({
        ...reply,
        participants: [
          { user: 'User9', position: 'x', score: 9 },
          { user: 'User1', position: 'x', score: 42 },
          { user: 'User1', position: 'dup', score: 1 },
          { user: 'User2', position: 'y', score: -3 },
          { user: 'User3', position: 'z', score: 'n/a' },
        ],
      }),
      known,
    )!;
    expect(j.participants.map((p) => [p.user, p.score])).toEqual([
      ['User1', 10],
      ['User2', 0],
      ['User3', 5],
    ]);
  });

  it('nulls the leader for values, tie and no-debate verdicts, and for unknown aliases', () => {
    for (const kind of ['values', 'tie', 'no_debate']) {
      const j = parseJudgment(JSON.stringify({ ...reply, verdict: { kind, leader: 'User1', summary: 's' } }), known)!;
      expect(j.verdict.leader).toBeNull();
    }
    const j = parseJudgment(JSON.stringify({ ...reply, verdict: { kind: 'evidence', leader: 'User7', summary: 's' } }), known)!;
    expect(j.verdict.leader).toBeNull();
    const f = parseJudgment(JSON.stringify({ ...reply, facts: [{ question: 'q', assessment: 'a', favors: 'Nobody' }] }), known)!;
    expect(f.facts[0].favors).toBeNull();
  });

  it('defaults unknown verdict kinds to mixed and caps list lengths', () => {
    const many = Array.from({ length: 9 }, () => ({ question: 'q', assessment: 'a', sides: 's', favors: null }));
    const j = parseJudgment(JSON.stringify({ ...reply, facts: many, values: many, verdict: { kind: 'win', summary: 's' } }), known)!;
    expect(j.verdict.kind).toBe('mixed');
    expect(j.facts).toHaveLength(5);
    expect(j.values).toHaveLength(3);
  });

  it('returns null for unusable replies', () => {
    expect(parseJudgment('no json', known)).toBeNull();
    expect(parseJudgment('{broken', known)).toBeNull();
    expect(parseJudgment('{"participants":[],"verdict":{}}', known)).toBeNull();
  });
});

describe('buildJudgmentEmbed', () => {
  const j = parseJudgment(JSON.stringify(reply), known)!;

  it('restores real names everywhere and leaves no aliases', () => {
    const json = JSON.stringify(buildJudgmentEmbed(j, restore, { messageCount: 40, window: 'last 30 minutes' }).toJSON());
    expect(json).not.toMatch(/User\d/);
    expect(json).toContain('Alice makes the better-supported case');
    expect(json).toContain('Alice: 8/10');
    expect(json).toContain('(favors Alice)');
    expect(json).toContain('40 messages, last 30 minutes');
  });

  it('has a headline for each verdict kind', () => {
    const h = (kind: Judgment['verdict']['kind'], leader: string | null) =>
      headline({ ...j, verdict: { kind, leader, summary: '' } }, restore);
    expect(h('evidence', 'User2')).toBe('Bob makes the better-supported case');
    expect(h('mixed', 'User1')).toMatch(/Mixed, with Alice/);
    expect(h('values', null)).toMatch(/values disagreement/);
    expect(h('tie', null)).toMatch(/^Even/);
    expect(h('no_debate', null)).toMatch(/No real disagreement/);
  });

  it('stays within Discord embed limits for very long content', () => {
    const long = 'x'.repeat(5000);
    const big: Judgment = {
      topic: long,
      participants: Array.from({ length: 6 }, (_, i) => ({
        user: `User${(i % 3) + 1}`, position: long, evidence: long, strengths: long, weaknesses: long, score: 5,
      })),
      facts: Array.from({ length: 5 }, () => ({ question: long, assessment: long, favors: 'User1' })),
      values: Array.from({ length: 3 }, () => ({ question: long, sides: long })),
      verdict: { kind: 'evidence', leader: 'User1', summary: long },
    };
    const e = buildJudgmentEmbed(big, restore, { messageCount: 500 }).toJSON();
    expect(e.title!.length).toBeLessThanOrEqual(256);
    expect(e.description!.length).toBeLessThanOrEqual(4096);
    for (const f of e.fields ?? []) {
      expect(f.name.length).toBeLessThanOrEqual(256);
      expect(f.value.length).toBeLessThanOrEqual(1024);
    }
    const total =
      e.title!.length + e.description!.length + e.footer!.text.length +
      (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
  });
});

describe('/judge options', () => {
  it('has topic, count and time', () => {
    const opts = Object.fromEntries((data.toJSON().options ?? []).map((o: any) => [o.name, o]));
    expect(opts.topic).toMatchObject({ type: 3, max_length: 200, required: false });
    expect(opts.count).toMatchObject({ type: 4, min_value: 10, max_value: 500 });
    expect(opts.time).toMatchObject({ type: 4, min_value: 1, max_value: 1440 });
  });
});
