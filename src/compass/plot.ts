import { Resvg } from '@resvg/resvg-js';
import { FONT_FAMILY, FONT_FILES } from '../fonts.js';
import { AXIS_MAX, AXIS_MIN } from './types.js';

export interface PlotPoint {
  name: string;
  economic: number;
  social: number;
  /** Drawn in the accent color with a bold label (the person who asked). */
  highlight?: boolean;
}

export interface PlotResult {
  svg: string;
}

// Canvas and plot area (square).
const WIDTH = 1000;
const HEIGHT = 1000;
const PLOT_X = 100;
const PLOT_Y = 110;
const PLOT_SIZE = 800;

const FONT = FONT_FAMILY;
const LABEL_SIZE = 14;
const DOT_R = 6;
const HIGHLIGHT_R = 7;
// How far from its dot a label may be moved (with a leader line) to find space.
const MAX_LABEL_DISTANCE = 170;
const RING_STEP = 18;

// Light surface with recessive quadrant tints in the familiar compass hues.
const COLORS = {
  surface: '#fcfcfb',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#7a7975',
  axis: '#52514e',
  grid: '#ffffff',
  border: '#d9d8d4',
  authLeft: '#fbe3e3',
  authRight: '#e1ecfa',
  libLeft: '#e3f3e4',
  libRight: '#ede6f7',
  dot: '#1f1f1e',
  highlight: '#eb6834',
  leader: '#8a8984',
};

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

export function toPixel(economic: number, social: number): { x: number; y: number } {
  const span = AXIS_MAX - AXIS_MIN;
  return {
    x: PLOT_X + ((economic - AXIS_MIN) / span) * PLOT_SIZE,
    // Authoritarian (+10) at the top.
    y: PLOT_Y + ((AXIS_MAX - social) / span) * PLOT_SIZE,
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

// Labels may spill into the margins (axis text is registered as an obstacle).
const LABEL_BOUNDS = { x1: 10, y1: PLOT_Y - 26, x2: WIDTH - 10, y2: PLOT_Y + PLOT_SIZE + 36 };

const WIDE_CHAR = /[\p{Extended_Pictographic}\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u;

/** Rough rendered width: emoji and CJK are about one em wide, other glyphs ~0.62 em. */
export function textWidth(text: string, size: number, bold = false): number {
  let ems = 0;
  for (const ch of text) {
    if (/\p{Mark}|\u200D|\uFE0F/u.test(ch)) continue; // combining marks, ZWJ, variation selectors
    ems += WIDE_CHAR.test(ch) ? 1.15 : bold ? 0.68 : 0.62;
  }
  return ems * size;
}

function textBox(x: number, y: number, text: string, size: number, anchor: string, bold = false): Box {
  const w = textWidth(text, size, bold);
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x1: x1 - 2, y1: y - size * 0.8 - 2, x2: x1 + w + 2, y2: y + size * 0.25 + 2 };
}

type Anchor = 'start' | 'end' | 'middle';

interface Spot {
  x: number;
  y: number;
  anchor: Anchor;
  box: Box;
  /** Distance from the dot center to the label anchor point. */
  dist: number;
}

// Right, left, up, down first, then the diagonals.
const ANGLES = [0, 180, 90, 270, 30, 150, 210, 330, 60, 120, 240, 300];

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

function inBounds(box: Box): boolean {
  const b = LABEL_BOUNDS;
  return box.x1 >= b.x1 && box.x2 <= b.x2 && box.y1 >= b.y1 && box.y2 <= b.y2;
}

/** The label position at a given angle (degrees, 0 = right, 90 = up) and distance. */
function spotAt(text: string, dot: { x: number; y: number }, angle: number, dist: number, bold: boolean): Spot {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const px = dot.x + cos * dist;
  const py = dot.y - sin * dist;
  const h = LABEL_SIZE;
  const anchor: Anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
  // Sideways: vertically centered on the point. Above: text sits on it. Below: hangs from it.
  const y = sin > 0.3 ? py : sin < -0.3 ? py + h * 0.8 : py + h * 0.35;
  return { x: px, y, anchor, box: textBox(px, y, text, h, anchor, bold), dist };
}

/**
 * Searches rings of increasing distance around the dot for a spot that stays
 * in bounds and clears every obstacle. If none is clear, returns the in-bounds
 * spot with the least overlap, so every label is always placed.
 */
function placeLabel(text: string, dot: { x: number; y: number }, r: number, taken: Box[], bold: boolean): Spot {
  const near = r + 4;
  let best: { spot: Spot; cost: number } | undefined;
  for (let dist = near; dist <= MAX_LABEL_DISTANCE; dist += RING_STEP) {
    for (const angle of ANGLES) {
      const spot = spotAt(text, dot, angle, dist, bold);
      if (!inBounds(spot.box)) continue;
      const overlap = taken.reduce((sum, t) => sum + overlapArea(t, spot.box), 0);
      if (overlap === 0) return spot;
      const cost = overlap + dist; // prefer less overlap, then closer
      if (!best || cost < best.cost) best = { spot, cost };
    }
  }
  return best?.spot ?? spotAt(text, dot, 0, near, bold);
}

/** Leader line from the dot's edge to the nearest point of the label box. */
function leaderLine(dot: { x: number; y: number; r: number }, box: Box): string {
  const tx = Math.max(box.x1, Math.min(dot.x, box.x2));
  const ty = Math.max(box.y1, Math.min(dot.y, box.y2));
  const dx = tx - dot.x;
  const dy = ty - dot.y;
  const len = Math.hypot(dx, dy) || 1;
  const sx = dot.x + (dx / len) * (dot.r + 2);
  const sy = dot.y + (dy / len) * (dot.r + 2);
  const f = (n: number) => n.toFixed(1);
  return `<line class="leader" x1="${f(sx)}" y1="${f(sy)}" x2="${f(tx)}" y2="${f(ty)}" stroke="${COLORS.leader}" stroke-width="1"/>`;
}

export function buildCompassSvg(points: PlotPoint[], title: string): PlotResult {
  const out: string[] = [];
  const mid = PLOT_SIZE / 2;
  const cell = PLOT_SIZE / (AXIS_MAX - AXIS_MIN);

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.surface}"/>`,
  );

  // Title and count.
  out.push(
    `<text x="${PLOT_X}" y="48" font-size="26" font-weight="bold" fill="${COLORS.textPrimary}">${escapeXml(truncate(title, 50))}</text>`,
    `<text x="${PLOT_X}" y="78" font-size="16" fill="${COLORS.textSecondary}">${points.length} ${points.length === 1 ? 'person' : 'people'}</text>`,
  );

  // Quadrants.
  const q = (x: number, y: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${mid}" height="${mid}" fill="${fill}"/>`;
  out.push(
    q(PLOT_X, PLOT_Y, COLORS.authLeft),
    q(PLOT_X + mid, PLOT_Y, COLORS.authRight),
    q(PLOT_X, PLOT_Y + mid, COLORS.libLeft),
    q(PLOT_X + mid, PLOT_Y + mid, COLORS.libRight),
  );

  // Grid every unit, recessive.
  for (let i = 1; i < AXIS_MAX - AXIS_MIN; i++) {
    if (i === (AXIS_MAX - AXIS_MIN) / 2) continue;
    const p = i * cell;
    out.push(
      `<line x1="${PLOT_X + p}" y1="${PLOT_Y}" x2="${PLOT_X + p}" y2="${PLOT_Y + PLOT_SIZE}" stroke="${COLORS.grid}" stroke-width="1"/>`,
      `<line x1="${PLOT_X}" y1="${PLOT_Y + p}" x2="${PLOT_X + PLOT_SIZE}" y2="${PLOT_Y + p}" stroke="${COLORS.grid}" stroke-width="1"/>`,
    );
  }

  // Border and center axes.
  out.push(
    `<rect x="${PLOT_X}" y="${PLOT_Y}" width="${PLOT_SIZE}" height="${PLOT_SIZE}" fill="none" stroke="${COLORS.border}" stroke-width="1"/>`,
    `<line x1="${PLOT_X + mid}" y1="${PLOT_Y}" x2="${PLOT_X + mid}" y2="${PLOT_Y + PLOT_SIZE}" stroke="${COLORS.axis}" stroke-width="1.5"/>`,
    `<line x1="${PLOT_X}" y1="${PLOT_Y + mid}" x2="${PLOT_X + PLOT_SIZE}" y2="${PLOT_Y + mid}" stroke="${COLORS.axis}" stroke-width="1.5"/>`,
  );

  // Axis names and ticks. Their boxes become obstacles for name labels.
  const obstacles: Box[] = [];
  const axisText = (x: number, y: number, text: string, anchor = 'middle') => {
    obstacles.push(textBox(x, y, text, 16, anchor));
    return `<text x="${x}" y="${y}" font-size="16" font-weight="bold" fill="${COLORS.textSecondary}" text-anchor="${anchor}">${text}</text>`;
  };
  out.push(
    axisText(PLOT_X + mid, PLOT_Y - 12, 'Authoritarian'),
    axisText(PLOT_X + mid, PLOT_Y + PLOT_SIZE + 26, 'Libertarian'),
    axisText(PLOT_X - 14, PLOT_Y + mid + 6, 'Left', 'end'),
    axisText(PLOT_X + PLOT_SIZE + 14, PLOT_Y + mid + 6, 'Right', 'start'),
  );

  // Tick values along the bottom and left edges.
  for (const v of [-10, -5, 5, 10]) {
    const { x } = toPixel(v, 0);
    const { y } = toPixel(0, v);
    obstacles.push(textBox(PLOT_X - 10, y + 4, String(v), 12, 'end'));
    out.push(
      `<text x="${x}" y="${PLOT_Y + PLOT_SIZE + 50}" font-size="12" fill="${COLORS.textMuted}" text-anchor="middle">${v}</text>`,
      `<text x="${PLOT_X - 10}" y="${y + 4}" font-size="12" fill="${COLORS.textMuted}" text-anchor="end">${v}</text>`,
    );
  }

  // People at the same spot share one dot and one combined label.
  const groups = new Map<string, { x: number; y: number; names: string[]; highlight: boolean }>();
  for (const p of points) {
    const { x, y } = toPixel(p.economic, p.social);
    const key = `${Math.round(x)},${Math.round(y)}`;
    const g = groups.get(key) ?? { x, y, names: [], highlight: false };
    g.names.push(p.name);
    g.highlight ||= !!p.highlight;
    groups.set(key, g);
  }

  // Dots: the highlighted one last so it sits on top.
  const dots = [...groups.values()]
    .sort((a, b) => Number(a.highlight) - Number(b.highlight))
    .map((g) => ({ ...g, r: g.highlight ? HIGHLIGHT_R : DOT_R }));
  for (const d of dots) {
    out.push(
      `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.highlight ? COLORS.highlight : COLORS.dot}" stroke="${COLORS.surface}" stroke-width="2"/>`,
    );
  }

  // Labels: dots and axis text are obstacles. The highlighted label goes first,
  // then dots in crowded areas, which have the fewest free spots.
  const taken: Box[] = [
    ...obstacles,
    ...dots.map((d) => ({ x1: d.x - d.r - 1, y1: d.y - d.r - 1, x2: d.x + d.r + 1, y2: d.y + d.r + 1 })),
  ];
  const crowding = (d: (typeof dots)[number]) =>
    dots.filter((o) => o !== d && Math.hypot(o.x - d.x, o.y - d.y) < 60).length;
  const labelOrder = [...dots].sort(
    (a, b) => Number(b.highlight) - Number(a.highlight) || crowding(b) - crowding(a),
  );

  const leaders: string[] = [];
  const labels: string[] = [];
  for (const d of labelOrder) {
    const text = d.names.join(', ');
    const spot = placeLabel(text, d, d.r, taken, d.highlight);
    taken.push(spot.box);
    if (spot.dist > d.r + 4 + 1) leaders.push(leaderLine(d, spot.box));
    labels.push(
      `<text x="${spot.x.toFixed(1)}" y="${spot.y.toFixed(1)}" font-size="${LABEL_SIZE}" font-weight="${d.highlight ? 'bold' : 'normal'}" fill="${COLORS.textPrimary}" text-anchor="${spot.anchor}" stroke="${COLORS.surface}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(text)}</text>`,
    );
  }
  out.push(...leaders, ...labels);

  out.push('</svg>');
  return { svg: out.join('\n') };
}

export function renderPng(svg: string, width = WIDTH): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return Buffer.from(resvg.render().asPng());
}
