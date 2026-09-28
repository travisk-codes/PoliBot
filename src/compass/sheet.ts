import { auth as googleAuth, sheets as sheetsApi, type sheets_v4 } from '@googleapis/sheets';
import { entryToRow, findRowIndex, HEADERS, rowToEntry } from './rows.js';
import type { CompassEntry, CompassStore } from './types.js';

export interface SheetConfig {
  spreadsheetId: string;
  tab: string;
  /** Path to the service account JSON key file. */
  keyFile?: string;
  /** Or the key file's contents, for hosts where writing a file is awkward. */
  credentialsJson?: string;
}

/** Reads config from env. Returns null if Google Sheets isn't configured. */
export function sheetConfigFromEnv(): SheetConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!spreadsheetId || (!keyFile && !credentialsJson)) return null;
  return {
    spreadsheetId,
    tab: process.env.COMPASS_SHEET_TAB?.trim() || 'Compass',
    keyFile: keyFile || undefined,
    credentialsJson: credentialsJson || undefined,
  };
}

/** Stores entries in one tab of a Google Sheet, one row per (server, user). */
export class GoogleSheetStore implements CompassStore {
  private api: sheets_v4.Sheets;
  private sheetId: number | undefined;
  // Serializes operations so concurrent commands can't clobber each other's rows.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private config: SheetConfig,
    api?: sheets_v4.Sheets, // injectable for tests
  ) {
    if (api) {
      this.api = api;
      return;
    }
    const client = new googleAuth.GoogleAuth({
      keyFile: config.keyFile,
      credentials: config.credentialsJson ? JSON.parse(config.credentialsJson) : undefined,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = sheetsApi({ version: 'v4', auth: client });
  }

  private get range(): string {
    return `'${this.config.tab.replace(/'/g, "''")}'`;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Creates the tab and header row on first use. */
  private async ensureTab(): Promise<number> {
    if (this.sheetId !== undefined) return this.sheetId;
    const { spreadsheetId, tab } = this.config;

    const meta = await this.api.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    });
    let sheetId = meta.data.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;

    if (sheetId == null) {
      const res = await this.api.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
      });
      sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
      if (sheetId == null) throw new Error(`Could not create the "${tab}" tab.`);
    }

    const header = await this.api.spreadsheets.values.get({
      spreadsheetId,
      range: `${this.range}!A1:F1`,
    });
    if (!header.data.values?.[0]?.length) {
      await this.api.spreadsheets.values.update({
        spreadsheetId,
        range: `${this.range}!A1:F1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }

    this.sheetId = sheetId;
    return sheetId;
  }

  /** All data rows (header excluded), as raw cell values. */
  private async readRows(): Promise<unknown[][]> {
    await this.ensureTab();
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${this.range}!A2:F`,
    });
    return res.data.values ?? [];
  }

  list(guildId: string): Promise<CompassEntry[]> {
    return this.run(async () =>
      (await this.readRows())
        .map(rowToEntry)
        .filter((e): e is CompassEntry => e !== null && e.guildId === guildId),
    );
  }

  get(guildId: string, userId: string): Promise<CompassEntry | undefined> {
    return this.run(async () => {
      const rows = await this.readRows();
      return rowToEntry(rows[findRowIndex(rows, guildId, userId)]) ?? undefined;
    });
  }

  upsert(entry: CompassEntry): Promise<void> {
    return this.run(async () => {
      const rows = await this.readRows();
      const index = findRowIndex(rows, entry.guildId, entry.userId);
      // RAW keeps IDs as text; parsing would turn 18-digit IDs into rounded numbers.
      if (index >= 0) {
        const rowNumber = index + 2; // +1 for 1-based, +1 for the header
        await this.api.spreadsheets.values.update({
          spreadsheetId: this.config.spreadsheetId,
          range: `${this.range}!A${rowNumber}:F${rowNumber}`,
          valueInputOption: 'RAW',
          requestBody: { values: [entryToRow(entry)] },
        });
      } else {
        await this.api.spreadsheets.values.append({
          spreadsheetId: this.config.spreadsheetId,
          range: `${this.range}!A:F`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [entryToRow(entry)] },
        });
      }
    });
  }

  remove(guildId: string, userId: string): Promise<boolean> {
    return this.run(async () => {
      const sheetId = await this.ensureTab();
      const rows = await this.readRows();
      const index = findRowIndex(rows, guildId, userId);
      if (index < 0) return false;
      await this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                // 0-based, end-exclusive; +1 skips the header row.
                range: { sheetId, dimension: 'ROWS', startIndex: index + 1, endIndex: index + 2 },
              },
            },
          ],
        },
      });
      return true;
    });
  }
}

let store: CompassStore | null | undefined;

/** The configured store, or null if Google Sheets isn't set up. */
export function getCompassStore(): CompassStore | null {
  if (store === undefined) {
    const config = sheetConfigFromEnv();
    store = config ? new GoogleSheetStore(config) : null;
  }
  return store;
}
