import { Resvg } from '@resvg/resvg-js';
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
  /** Labels that didn't fit next to their dot and were drawn as numbers instead. */
  numbered: Array<{ number: number; name: string }>;
}

// Canvas and plot area (square).
const WIDTH = 1000;
const HEIGHT = 1000;
const PLOT_X = 100;
const PLOT_Y = 110;
const PLOT_SIZE = 800;

const FONT = "'DejaVu Sans', 'Segoe UI', Arial, Helvetica, sans-serif";
const LABEL_SIZE = 14;
const DOT_R = 6;
const HIGHLIGHT_R = 7;
const NAME_MAX = 20;

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

function textBox(x: number, y: number, text: string, size: number, anchor: string): Box {
  const w = [...text].length * size * 0.62;
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x1: x1 - 2, y1: y - size * 0.8 - 2, x2: x1 + w + 2, y2: y + size * 0.25 + 2 };
}

/**
 * Tries positions around a dot (right, left, above, below, diagonals) and
 * returns the first whose box stays in the plot and clears other labels and dots.
 */
function placeLabel(
  text: string,
  dot: { x: number; y: number },
  r: number,
  taken: Box[],
): { x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box } | null {
  const h = LABEL_SIZE;
  const gap = r + 4;
  const candidates: Array<{ x: number; y: number; anchor: 'start' | 'end' | 'middle' }> = [
    { x: dot.x + gap, y: dot.y + h * 0.35, anchor: 'start' },
    { x: dot.x - gap, y: dot.y + h * 0.35, anchor: 'end' },
    { x: dot.x, y: dot.y - gap, anchor: 'middle' },
    { x: dot.x, y: dot.y + gap + h * 0.8, anchor: 'middle' },
    { x: dot.x + gap * 0.8, y: dot.y - gap * 0.8, anchor: 'start' },
    { x: dot.x - gap * 0.8, y: dot.y - gap * 0.8, anchor: 'end' },
    { x: dot.x + gap * 0.8, y: dot.y + gap * 0.8 + h * 0.7, anchor: 'start' },
    { x: dot.x - gap * 0.8, y: dot.y + gap * 0.8 + h * 0.7, anchor: 'end' },
  ];

  for (const c of candidates) {
    const box = textBox(c.x, c.y, text, LABEL_SIZE, c.anchor);
    const b = LABEL_BOUNDS;
    const inside = box.x1 >= b.x1 && box.x2 <= b.x2 && box.y1 >= b.y1 && box.y2 <= b.y2;
    if (inside && !taken.some((t) => overlaps(t, box))) return { ...c, box };
  }
  return null;
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

  // Labels: dots count as obstacles. Highlighted label first so it gets the best spot.
  const taken: Box[] = [
    ...obstacles,
    ...dots.map((d) => ({ x1: d.x - d.r - 1, y1: d.y - d.r - 1, x2: d.x + d.r + 1, y2: d.y + d.r + 1 })),
  ];
  const numbered: PlotResult['numbered'] = [];
  const labelOrder = [...dots].reverse();
  for (const d of labelOrder) {
    const fullName = d.names.join(', ');
    let text = d.names.map((n) => truncate(n, NAME_MAX)).join(', ');
    let spot = placeLabel(text, d, d.r, taken);
    if (!spot) {
      text = String(numbered.length + 1);
      spot = placeLabel(text, d, d.r, taken);
      numbered.push({ number: numbered.length + 1, name: fullName });
    }
    if (!spot) {
      // Nowhere clear even for a number: put it to the right anyway.
      spot = { x: d.x + d.r + 4, y: d.y + LABEL_SIZE * 0.35, anchor: 'start', box: { x1: 0, y1: 0, x2: 0, y2: 0 } };
    }
    taken.push(spot.box);
    out.push(
      `<text x="${spot.x}" y="${spot.y}" font-size="${LABEL_SIZE}" font-weight="${d.highlight ? 'bold' : 'normal'}" fill="${COLORS.textPrimary}" text-anchor="${spot.anchor}" stroke="${COLORS.surface}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(text)}</text>`,
    );
  }

  out.push('</svg>');
  return { svg: out.join('\n'), numbered };
}

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return Buffer.from(resvg.render().asPng());
}
