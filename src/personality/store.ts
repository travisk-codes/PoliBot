import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_DIMENSIONS, type Scores } from './traits.js';

export interface Profile {
  scores: Scores;
  halfA: Scores;
  halfB: Scores;
  messageCount: number;
  updatedAt: string;
}

interface GuildData {
  optedIn: Record<string, string>; // userId -> opted-in timestamp
  dimensions?: string[];
  calibratedAt?: string;
  profiles: Record<string, Profile>;
}

/** Opt-ins, chosen dimensions, and cached scores. No message text is stored. */
export class PersonalityStore {
  private data: Record<string, GuildData> | undefined;

  constructor(private file: string) {}

  private load(): Record<string, GuildData> {
    if (!this.data) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        this.data = {};
      }
    }
    return this.data!;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.load(), null, 2));
    renameSync(tmp, this.file);
  }

  private guild(guildId: string): GuildData {
    const all = this.load();
    all[guildId] ??= { optedIn: {}, profiles: {} };
    return all[guildId];
  }

  optIn(guildId: string, userId: string): boolean {
    const g = this.guild(guildId);
    const already = userId in g.optedIn;
    g.optedIn[userId] ??= new Date().toISOString();
    this.save();
    return !already;
  }

  /** Removes the opt-in and any cached profile. */
  optOut(guildId: string, userId: string): boolean {
    const g = this.guild(guildId);
    const was = userId in g.optedIn;
    delete g.optedIn[userId];
    delete g.profiles[userId];
    this.save();
    return was;
  }

  isOptedIn(guildId: string, userId: string): boolean {
    return userId in this.guild(guildId).optedIn;
  }

  optedInUsers(guildId: string): string[] {
    return Object.keys(this.guild(guildId).optedIn);
  }

  dimensions(guildId: string): { ids: string[]; calibratedAt?: string } {
    const g = this.guild(guildId);
    return { ids: g.dimensions?.length ? g.dimensions : DEFAULT_DIMENSIONS, calibratedAt: g.calibratedAt };
  }

  setDimensions(guildId: string, ids: string[]): void {
    const g = this.guild(guildId);
    g.dimensions = ids;
    g.calibratedAt = new Date().toISOString();
    this.save();
  }

  getProfile(guildId: string, userId: string): Profile | undefined {
    return this.guild(guildId).profiles[userId];
  }

  /** Only stored for opted-in users. */
  setProfile(guildId: string, userId: string, profile: Profile): void {
    const g = this.guild(guildId);
    if (!(userId in g.optedIn)) return;
    g.profiles[userId] = profile;
    this.save();
  }
}

let store: PersonalityStore | undefined;

export function getPersonalityStore(): PersonalityStore {
  store ??= new PersonalityStore(
    resolve(process.env.PERSONALITY_STORE_PATH || 'data/personality.json'),
  );
  return store;
}
