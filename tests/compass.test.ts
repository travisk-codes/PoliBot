import type { sheets_v4 } from '@googleapis/sheets';
import { describe, expect, it } from 'vitest';
import { buildCompassSvg, renderPng, textWidth, toPixel } from '../src/compass/plot.js';
import { entryToRow, findRowIndex, HEADERS, rowToEntry } from '../src/compass/rows.js';
import { GoogleSheetStore } from '../src/compass/sheet.js';
import { quadrantName, type CompassEntry } from '../src/compass/types.js';

const G = '684799392854704184';

function entry(overrides: Partial<CompassEntry> = {}): CompassEntry {
  return {
    guildId: G,
    userId: '111111111111111111',
    name: 'Alice',
    economic: -3.5,
    social: 2.25,
    updatedAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('rows', () => {
  it('round-trips an entry', () => {
    expect(rowToEntry(entryToRow(entry()))).toEqual(entry());
  });

  it('rejects blank, malformed, and out-of-range rows', () => {
    expect(rowToEntry(undefined)).toBeNull();
    expect(rowToEntry([])).toBeNull();
    expect(rowToEntry([G, 'abc', 'x', '1', '1'])).toBeNull();
    expect(rowToEntry([G, '1', 'x', '11', '0'])).toBeNull();
    expect(rowToEntry([G, '1', 'x', '', '0'])).toBeNull();
    expect(rowToEntry([G, '1', 'x', 'left', '0'])).toBeNull();
  });

  it('accepts numbers typed into the sheet by hand', () => {
    expect(rowToEntry([G, '1', '', 4, -2])).toMatchObject({ economic: 4, social: -2, name: 'Unknown' });
  });

  it('finds rows by server and user', () => {
    const rows = [[G, '1'], ['999', '2'], [G, '2']];
    expect(findRowIndex(rows, G, '2')).toBe(2);
    expect(findRowIndex(rows, G, '3')).toBe(-1);
  });
});

describe('quadrantName', () => {
  it('names quadrants and centrist positions', () => {
    expect(quadrantName(-3, -4)).toBe('Libertarian Left');
    expect(quadrantName(5, 5)).toBe('Authoritarian Right');
    expect(quadrantName(0, 0)).toBe('Centrist');
    expect(quadrantName(2, 0)).toBe('Centrist Right');
    expect(quadrantName(0, -1)).toBe('Libertarian Centrist');
  });
});

/** Minimal in-memory stand-in for the parts of the Sheets API the store uses. */
function fakeSheetsApi() {
  const tabs = new Map<string, { sheetId: number; rows: unknown[][] }>();
  let nextId = 100;
  const tabOf = (range: string) => /^'((?:[^']|'')*)'/.exec(range)![1].replace(/''/g, "'");
  const rowNum = (range: string) => Number(/![A-Z]+(\d+)/.exec(range)?.[1]);

  const api = {
    spreadsheets: {
      get: async () => ({
        data: { sheets: [...tabs].map(([title, t]) => ({ properties: { title, sheetId: t.sheetId } })) },
      }),
      batchUpdate: async ({ requestBody }: any) => {
        const req = requestBody.requests[0];
        if (req.addSheet) {
          const sheetId = nextId++;
          tabs.set(req.addSheet.properties.title, { sheetId, rows: [] });
          return { data: { replies: [{ addSheet: { properties: { sheetId } } }] } };
        }
        const { sheetId, startIndex, endIndex } = req.deleteDimension.range;
        const tab = [...tabs.values()].find((t) => t.sheetId === sheetId)!;
        tab.rows.splice(startIndex, endIndex - startIndex);
        return { data: {} };
      },
      values: {
        get: async ({ range }: any) => {
          const rows = tabs.get(tabOf(range))!.rows;
          const start = rowNum(range);
          const end = range.endsWith(':F') ? rows.length : Number(/:[A-Z]+(\d+)$/.exec(range)![1]);
          const values = rows.slice(start - 1, end);
          return { data: { values: values.length ? values : undefined } };
        },
        update: async ({ range, requestBody }: any) => {
          tabs.get(tabOf(range))!.rows[rowNum(range) - 1] = requestBody.values[0];
          return { data: {} };
        },
        append: async ({ range, requestBody }: any) => {
          tabs.get(tabOf(range))!.rows.push(requestBody.values[0]);
          return { data: {} };
        },
      },
    },
  };
  return { api: api as unknown as sheets_v4.Sheets, tabs };
}

describe('GoogleSheetStore', () => {
  it('creates the tab with headers, then inserts, updates, lists, and removes rows', async () => {
    const { api, tabs } = fakeSheetsApi();
    const store = new GoogleSheetStore({ spreadsheetId: 'x', tab: "Maggie's Compass" }, api);

    await store.upsert(entry({ userId: '1', name: 'A' }));
    await store.upsert(entry({ userId: '2', name: 'B' }));
    await store.upsert(entry({ guildId: '999', userId: '1', name: 'Other server' }));
    await store.upsert(entry({ userId: '1', name: 'A2', economic: 9 }));

    const rows = tabs.get("Maggie's Compass")!.rows;
    expect(rows[0]).toEqual(HEADERS);
    expect(rows).toHaveLength(4); // header + 3, updated in place

    expect((await store.list(G)).map((e) => [e.name, e.economic])).toEqual([
      ['A2', 9],
      ['B', -3.5],
    ]);
    expect((await store.get(G, '2'))?.name).toBe('B');

    expect(await store.remove(G, '1')).toBe(true);
    expect(await store.remove(G, '1')).toBe(false);
    expect(rows[0]).toEqual(HEADERS); // header survives deletion
    expect((await store.list(G)).map((e) => e.name)).toEqual(['B']);
    expect((await store.list('999')).map((e) => e.name)).toEqual(['Other server']);
  });

  it('serializes concurrent writes so none are lost', async () => {
    const { api } = fakeSheetsApi();
    const store = new GoogleSheetStore({ spreadsheetId: 'x', tab: 'Compass' }, api);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.upsert(entry({ userId: String(i + 1) }))),
    );
    expect(await store.list(G)).toHaveLength(10);
  });
});

describe('plot', () => {
  it('maps axes: right is +x, authoritarian is up', () => {
    const center = toPixel(0, 0);
    expect(toPixel(10, 0).x).toBeGreaterThan(center.x);
    expect(toPixel(0, 10).y).toBeLessThan(center.y);
  });

  it('escapes names and highlights the requester', () => {
    const { svg } = buildCompassSvg(
      [
        { name: '<script>&"x"', economic: 1, social: 1 },
        { name: 'Me', economic: -5, social: -5, highlight: true },
      ],
      'Test',
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;&#38;&#34;x&#34;');
    expect(svg).toContain('#eb6834');
    expect(svg).toContain('font-weight="bold" fill="#0b0b0b" text-anchor="start" stroke="#fcfcfb" stroke-width="3" stroke-linejoin="round" paint-order="stroke">Me<');
  });

  it('merges people at the same spot into one label', () => {
    const { svg } = buildCompassSvg(
      [
        { name: 'Ann', economic: 2, social: 2 },
        { name: 'Bob', economic: 2, social: 2 },
      ],
      'Test',
    );
    expect(svg.match(/<circle/g)).toHaveLength(1);
    expect(svg).toContain('>Ann, Bob<');
  });

  /** Label texts and their approximate boxes, parsed back out of the SVG. */
  function labels(svg: string) {
    return [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="14" font-weight="(\w+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)].map(
      (m) => {
        const [x, y, anchor, text] = [Number(m[1]), Number(m[2]), m[4], m[5]];
        const w = textWidth(text, 14, m[3] === 'bold');
        const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
        return { text, x1, x2: x1 + w, y1: y - 11, y2: y + 3.5 };
      },
    );
  }

  it('shows every full name, even in a crowded cluster of long names', () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ({
      name: `Person with a fairly long display name ${i}`,
      economic: 1 + i * 0.05,
      social: 1,
    }));
    const { svg } = buildCompassSvg(crowd, 'Test');
    const texts = labels(svg).map((l) => l.text);
    for (const p of crowd) expect(texts).toContain(p.name);
    expect(texts.some((t) => /^\d+$/.test(t))).toBe(false);
    // Labels pushed away from their dot get a leader line.
    expect(svg).toContain('class="leader"');
  });

  it('does not shorten long names', () => {
    const name = 'zenshift the financial wizard of the north';
    const { svg } = buildCompassSvg([{ name, economic: 0, social: 0 }], 'Test');
    expect(svg).toContain(`>${name}<`);
  });

  it('keeps labels next to their dots, without leader lines, when there is room', () => {
    const { svg } = buildCompassSvg(
      [
        { name: 'Alice', economic: -5, social: 5 },
        { name: 'Bob', economic: 5, social: -5 },
        { name: 'Carol', economic: 5, social: 5 },
      ],
      'Test',
    );
    expect(svg).not.toContain('class="leader"');
  });

  it('avoids overlapping labels when there is space nearby', () => {
    const pts = [
      { name: 'Klepto the Negromancer', economic: -2.6, social: -3.4 },
      { name: 'Mystery Member With A Long Name', economic: -1, social: -4 },
      { name: 'magz', economic: -2.5, social: -4.4, highlight: true },
      { name: 'zenshift the financial wizard', economic: 1, social: -5 },
      { name: 'Insufferable', economic: 0.1, social: -2.5 },
    ];
    const ls = labels(buildCompassSvg(pts, 'Test').svg);
    expect(ls).toHaveLength(5);
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const [a, b] = [ls[i], ls[j]];
        const overlap = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
        expect(overlap, `${a.text} / ${b.text}`).toBe(false);
      }
    }
  });

  it('estimates emoji and CJK as wider than Latin letters', () => {
    expect(textWidth('ab', 10)).toBeCloseTo(12.4);
    expect(textWidth('🌸', 10)).toBeGreaterThan(textWidth('a', 10));
    expect(textWidth('漢', 10)).toBeGreaterThan(textWidth('a', 10));
    expect(textWidth('👍🏽', 10)).toBeGreaterThan(0);
  });

  it('renders a PNG', () => {
    const png = renderPng(buildCompassSvg([{ name: 'A', economic: 0, social: 0 }], 'Test').svg);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
