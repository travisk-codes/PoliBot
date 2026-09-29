import { DEFAULT_DIMENSIONS, MAX_DIMENSIONS, type Scores } from './traits.js';

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Population standard deviation. */
export function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Pearson correlation, or null when either side has no variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Split-half correlation stepped up to full length (Spearman-Brown). */
export function spearmanBrown(r: number): number {
  return (2 * r) / (1 + r);
}

export interface SelectionOptions {
  minMembers: number;
  minReliability: number;
  minSpread: number;
  maxRedundancy: number;
  maxDimensions: number;
}

export const DEFAULT_SELECTION: SelectionOptions = {
  minMembers: 5,
  minReliability: 0.5,
  minSpread: 0.15,
  maxRedundancy: 0.7,
  maxDimensions: MAX_DIMENSIONS,
};

export type TraitStatus = 'kept' | 'unreliable' | 'flat' | 'redundant' | 'over limit';

export interface TraitResult {
  id: string;
  reliability: number | null;
  spread: number;
  status: TraitStatus;
  redundantWith?: string;
  correlation?: number;
}

export interface Selection {
  /** False when there weren't enough members to test; `chosen` is then the default set. */
  tested: boolean;
  members: number;
  results: TraitResult[];
  chosen: string[];
}

/**
 * Picks the traits that are measurable (split-half reliability), that differ
 * between people (spread), and that aren't duplicates of each other.
 */
export function selectTraits(
  halves: Array<{ a: Scores; b: Scores }>,
  traitIds: string[],
  options: Partial<SelectionOptions> = {},
): Selection {
  const opt = { ...DEFAULT_SELECTION, ...options };
  if (halves.length < opt.minMembers) {
    return { tested: false, members: halves.length, results: [], chosen: DEFAULT_DIMENSIONS };
  }

  const at = (s: Scores, id: string) => s[id] ?? 0;
  const full = (id: string) => halves.map((h) => (at(h.a, id) + at(h.b, id)) / 2);

  const results: TraitResult[] = traitIds.map((id) => {
    const r = pearson(halves.map((h) => at(h.a, id)), halves.map((h) => at(h.b, id)));
    return { id, reliability: r === null ? null : spearmanBrown(r), spread: sd(full(id)), status: 'kept' };
  });

  for (const res of results) {
    if (res.reliability === null || res.reliability < opt.minReliability) res.status = 'unreliable';
    else if (res.spread < opt.minSpread) res.status = 'flat';
  }

  const candidates = results
    .filter((r) => r.status === 'kept')
    .sort((x, y) => y.reliability! * y.spread - x.reliability! * x.spread);

  const chosen: string[] = [];
  for (const res of candidates) {
    const clash = chosen
      .map((id) => ({ id, r: pearson(full(res.id), full(id)) }))
      .find((c) => c.r !== null && Math.abs(c.r) >= opt.maxRedundancy);
    if (clash) {
      res.status = 'redundant';
      res.redundantWith = clash.id;
      res.correlation = clash.r!;
    } else if (chosen.length >= opt.maxDimensions) {
      res.status = 'over limit';
    } else {
      chosen.push(res.id);
    }
  }

  // Keep display order stable: follow the catalog order, not the ranking.
  const ordered = traitIds.filter((id) => chosen.includes(id));
  return { tested: true, members: halves.length, results, chosen: ordered };
}
