import type { sheets_v4 } from '@googleapis/sheets';
import { describe, expect, it } from 'vitest';
import { buildCompassSvg, renderPng, toPixel } from '../src/compass/plot.js';
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

  it('numbers labels that cannot fit and reports them', () => {
    const crowd = Array.from({ length: 12 }, (_, i) => ({
      name: `Person number ${i}`,
      economic: 1 + i * 0.05,
      social: 1,
    }));
    const { numbered } = buildCompassSvg(crowd, 'Test');
    expect(numbered.length).toBeGreaterThan(0);
    expect(numbered[0]).toMatchObject({ number: 1 });
  });

  it('renders a PNG', () => {
    const png = renderPng(buildCompassSvg([{ name: 'A', economic: 0, social: 0 }], 'Test').svg);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
