export interface CompassEntry {
  guildId: string;
  userId: string;
  name: string;
  /** Economic axis: -10 (left) to +10 (right). */
  economic: number;
  /** Social axis: -10 (libertarian) to +10 (authoritarian). */
  social: number;
  updatedAt: string;
}

export const AXIS_MIN = -10;
export const AXIS_MAX = 10;

export function isValidCoordinate(n: number): boolean {
  return Number.isFinite(n) && n >= AXIS_MIN && n <= AXIS_MAX;
}

/** Storage for compass entries. Implemented by Google Sheets in sheet.ts. */
export interface CompassStore {
  list(guildId: string): Promise<CompassEntry[]>;
  get(guildId: string, userId: string): Promise<CompassEntry | undefined>;
  upsert(entry: CompassEntry): Promise<void>;
  remove(guildId: string, userId: string): Promise<boolean>;
}

/** e.g. "Libertarian Left", "Authoritarian Right", "Centrist". */
export function quadrantName(economic: number, social: number): string {
  const social_ = social > 0 ? 'Authoritarian' : social < 0 ? 'Libertarian' : '';
  const econ = economic < 0 ? 'Left' : economic > 0 ? 'Right' : '';
  if (!social_ && !econ) return 'Centrist';
  if (!social_) return `Centrist ${econ}`;
  if (!econ) return `${social_} Centrist`;
  return `${social_} ${econ}`;
}
