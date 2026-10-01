import { FONT_FAMILY } from '../fonts.js';

export interface ChartRow {
  name: string;
  low: string;
  high: string;
  value: number;
}

// Categorical palette (light mode) from the dataviz reference, in fixed order.
// Color follows a trait's position in the server's chosen set, not its value.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

const C = {
  surface: '#fcfcfb',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#7a7975',
  track: '#efeeea',
  grid: '#dcdbd6',
  center: '#9a9994',
};

export const CHART_WIDTH = 1000;
const FONT = FONT_FAMILY;
const TRACK_X1 = 250;
const TRACK_X2 = 750;
const TRACK_MID = (TRACK_X1 + TRACK_X2) / 2;
const HALF = (TRACK_X2 - TRACK_X1) / 2;
const HEADER = 120;
const ROW_H = 76;
const BAR_H = 18;
const FOOTER = 64;

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('')}…`;
}

export function formatValue(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(2)}`;
}

export function buildPersonalitySvg(opts: {
  title: string;
  subtitle: string;
  rows: ChartRow[];
  footer: string;
}): { svg: string; height: number } {
  const height = HEADER + opts.rows.length * ROW_H + FOOTER;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${height}" viewBox="0 0 ${CHART_WIDTH} ${height}" font-family="${FONT}">`,
    `<rect width="${CHART_WIDTH}" height="${height}" fill="${C.surface}"/>`,
    `<text x="40" y="52" font-size="26" font-weight="bold" fill="${C.textPrimary}">${esc(truncate(opts.title, 55))}</text>`,
    `<text x="40" y="82" font-size="15" fill="${C.textSecondary}">${esc(opts.subtitle)}</text>`,
  ];

  // Scale ticks above the first row.
  const tickY = HEADER - 12;
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    const x = TRACK_MID + v * HALF;
    out.push(`<text x="${x}" y="${tickY}" font-size="11" fill="${C.textMuted}" text-anchor="middle">${v === 0 ? '0' : formatValue(v).replace('.00', '').replace(/0$/, '')}</text>`);
  }

  opts.rows.forEach((row, i) => {
    const top = HEADER + i * ROW_H;
    const barY = top + 38;
    const color = SERIES_COLORS[i % SERIES_COLORS.length];
    const v = Math.max(-1, Math.min(1, row.value));

    // Trait name with a color key, and the value.
    out.push(
      `<circle cx="${TRACK_X1 + 6}" cy="${top + 17}" r="6" fill="${color}"/>`,
      `<text x="${TRACK_X1 + 20}" y="${top + 22}" font-size="16" font-weight="bold" fill="${C.textPrimary}">${esc(truncate(row.name, 28))}</text>`,
      `<text x="${TRACK_X2}" y="${top + 22}" font-size="16" font-weight="bold" fill="${C.textPrimary}" text-anchor="end">${formatValue(v)}</text>`,
    );

    // Track, gridlines, center line.
    out.push(`<rect x="${TRACK_X1}" y="${barY}" width="${TRACK_X2 - TRACK_X1}" height="${BAR_H}" rx="4" fill="${C.track}"/>`);
    for (const g of [-0.5, 0.5]) {
      const gx = TRACK_MID + g * HALF;
      out.push(`<line x1="${gx}" y1="${barY}" x2="${gx}" y2="${barY + BAR_H}" stroke="${C.grid}" stroke-width="1"/>`);
    }

    // Bar from center to value. Round only the data end.
    const w = Math.abs(v) * HALF;
    if (w >= 1) {
      const x = v >= 0 ? TRACK_MID : TRACK_MID - w;
      const r = Math.min(4, w / 2);
      const [x0, x1] = [x, x + w];
      const path =
        v >= 0
          ? `M${x0},${barY} H${x1 - r} Q${x1},${barY} ${x1},${barY + r} V${barY + BAR_H - r} Q${x1},${barY + BAR_H} ${x1 - r},${barY + BAR_H} H${x0} Z`
          : `M${x1},${barY} H${x0 + r} Q${x0},${barY} ${x0},${barY + r} V${barY + BAR_H - r} Q${x0},${barY + BAR_H} ${x0 + r},${barY + BAR_H} H${x1} Z`;
      out.push(`<path d="${path}" fill="${color}"/>`);
    }
    out.push(`<line x1="${TRACK_MID}" y1="${barY - 4}" x2="${TRACK_MID}" y2="${barY + BAR_H + 4}" stroke="${C.center}" stroke-width="1.5"/>`);

    // Pole labels.
    out.push(
      `<text x="${TRACK_X1 - 14}" y="${barY + 14}" font-size="14" fill="${C.textSecondary}" text-anchor="end">${esc(truncate(row.low, 22))}</text>`,
      `<text x="${TRACK_X2 + 14}" y="${barY + 14}" font-size="14" fill="${C.textSecondary}">${esc(truncate(row.high, 22))}</text>`,
    );
  });

  out.push(
    `<text x="40" y="${height - 26}" font-size="13" fill="${C.textMuted}">${esc(opts.footer)}</text>`,
    '</svg>',
  );
  return { svg: out.join('\n'), height };
}
