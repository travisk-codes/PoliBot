import { isValidCoordinate, type CompassEntry } from './types.js';

/** Column order in the spreadsheet tab. Row 1 holds these headers. */
export const HEADERS = ['Server ID', 'User ID', 'Name', 'Economic', 'Social', 'Updated'];

export function entryToRow(e: CompassEntry): string[] {
  return [e.guildId, e.userId, e.name, String(e.economic), String(e.social), e.updatedAt];
}

/**
 * Converts a data row (without the header) to an entry. Returns null for blank
 * or malformed rows, e.g. ones someone edited by hand.
 */
export function rowToEntry(row: unknown[] | undefined): CompassEntry | null {
  if (!row) return null;
  const [guildId, userId, name, economic, social, updatedAt] = row.map((v) =>
    v == null ? '' : String(v).trim(),
  );
  const x = Number(economic);
  const y = Number(social);
  if (!/^\d+$/.test(guildId) || !/^\d+$/.test(userId)) return null;
  if (economic === '' || social === '' || !isValidCoordinate(x) || !isValidCoordinate(y)) {
    return null;
  }
  return { guildId, userId, name: name || 'Unknown', economic: x, social: y, updatedAt };
}

/**
 * Finds the 0-based index (into `rows`, header excluded) of a user's entry in a
 * server, or -1.
 */
export function findRowIndex(rows: unknown[][], guildId: string, userId: string): number {
  return rows.findIndex((r) => String(r?.[0] ?? '').trim() === guildId && String(r?.[1] ?? '').trim() === userId);
}
