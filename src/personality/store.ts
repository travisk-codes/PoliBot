import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ChannelSettings } from './channels.js';
import { DEFAULT_DIMENSIONS, type Scores } from './traits.js';

/**
 * Bumped when the way messages are chosen changes. Cached profiles from an
 * older version are rebuilt. Version 2: eligible (public) channels only,
 * balanced across channels.
 */
export const SAMPLE_VERSION = 2;

export interface Profile {
  scores: Scores;
  halfA: Scores;
  halfB: Scores;
  messageCount: number;
  channelCount?: number;
  sampleVersion?: number;
  updatedAt: string;
}

export interface SummaryEntry {
  text: string;
  messageCount: number;
  channelCount?: number;
  sampleVersion?: number;
  updatedAt: string;
}

interface GuildData {
  /** Opted in to metrics (trait charts). userId -> timestamp. */
  optedIn: Record<string, string>;
  /** Opted in to written summaries, separately. userId -> timestamp. */
  summaryOptedIn?: Record<string, string>;
  dimensions?: string[];
  calibratedAt?: string;
  channels?: ChannelSettings;
  profiles: Record<string, Profile>;
  /** userId -> channelId -> profile built from that channel only. */
  channelProfiles?: Record<string, Record<string, Profile>>;
  summaries?: Record<string, SummaryEntry>;
  /** userId -> channelId -> summary built from that channel only. */
  channelSummaries?: Record<string, Record<string, SummaryEntry>>;
}

function isCurrent<T extends { sampleVersion?: number }>(p: T | undefined): T | undefined {
  return p && p.sampleVersion === SAMPLE_VERSION ? p : undefined;
}

/** Deletes entries built with an older sampling method. */
function purgeStale<T extends { sampleVersion?: number }>(flat?: Record<string, T>, nested?: Record<string, Record<string, T>>): void {
  for (const [k, v] of Object.entries(flat ?? {})) if (!isCurrent(v)) delete flat![k];
  for (const inner of Object.values(nested ?? {})) {
    for (const [k, v] of Object.entries(inner)) if (!isCurrent(v)) delete inner[k];
  }
}

/** Opt-ins, channel settings, chosen dimensions, and cached scores. No message text is stored. */
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
      // Drop profiles built with an older sampling method (e.g. before
      // private channels were excluded) instead of keeping them around.
      for (const g of Object.values(this.data!)) {
        purgeStale(g.profiles, g.channelProfiles);
        purgeStale(g.summaries, g.channelSummaries);
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

  /** Removes the opt-in and every cached profile for the user. */
  optOut(guildId: string, userId: string): boolean {
    const g = this.guild(guildId);
    const was = userId in g.optedIn;
    delete g.optedIn[userId];
    delete g.profiles[userId];
    if (g.channelProfiles) delete g.channelProfiles[userId];
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

  // Channel settings. Any change clears cached profiles, since they were built
  // from a different set of channels.

  getChannelSettings(guildId: string): ChannelSettings {
    const c = this.guild(guildId).channels;
    return { excluded: [...(c?.excluded ?? [])], included: [...(c?.included ?? [])] };
  }

  private updateChannels(guildId: string, fn: (c: ChannelSettings) => void): void {
    const g = this.guild(guildId);
    const c = this.getChannelSettings(guildId);
    fn(c);
    g.channels = c;
    g.profiles = {};
    g.channelProfiles = {};
    g.summaries = {};
    g.channelSummaries = {};
    this.save();
  }

  excludeChannel(guildId: string, channelId: string): void {
    this.updateChannels(guildId, (c) => {
      c.included = c.included.filter((id) => id !== channelId);
      if (!c.excluded.includes(channelId)) c.excluded.push(channelId);
    });
  }

  includeChannel(guildId: string, channelId: string): void {
    this.updateChannels(guildId, (c) => {
      c.excluded = c.excluded.filter((id) => id !== channelId);
      if (!c.included.includes(channelId)) c.included.push(channelId);
    });
  }

  /** Back to the default: analyzed if public, not if private. */
  resetChannel(guildId: string, channelId: string): void {
    this.updateChannels(guildId, (c) => {
      c.excluded = c.excluded.filter((id) => id !== channelId);
      c.included = c.included.filter((id) => id !== channelId);
    });
  }

  // Profiles. Only stored for opted-in users; stale-version profiles are ignored.

  getProfile(guildId: string, userId: string): Profile | undefined {
    return isCurrent(this.guild(guildId).profiles[userId]);
  }

  setProfile(guildId: string, userId: string, profile: Profile): void {
    const g = this.guild(guildId);
    if (!(userId in g.optedIn)) return;
    g.profiles[userId] = { ...profile, sampleVersion: SAMPLE_VERSION };
    this.save();
  }

  getChannelProfile(guildId: string, userId: string, channelId: string): Profile | undefined {
    return isCurrent(this.guild(guildId).channelProfiles?.[userId]?.[channelId]);
  }

  setChannelProfile(guildId: string, userId: string, channelId: string, profile: Profile): void {
    const g = this.guild(guildId);
    if (!(userId in g.optedIn)) return;
    g.channelProfiles ??= {};
    g.channelProfiles[userId] ??= {};
    g.channelProfiles[userId][channelId] = { ...profile, sampleVersion: SAMPLE_VERSION };
    this.save();
  }

  // Written summaries: a separate opt-in and cache. Only the generated
  // summary text is stored, never message text.

  summaryOptIn(guildId: string, userId: string): boolean {
    const g = this.guild(guildId);
    g.summaryOptedIn ??= {};
    const already = userId in g.summaryOptedIn;
    g.summaryOptedIn[userId] ??= new Date().toISOString();
    this.save();
    return !already;
  }

  /** Removes the summary opt-in and every cached summary for the user. */
  summaryOptOut(guildId: string, userId: string): boolean {
    const g = this.guild(guildId);
    const was = !!g.summaryOptedIn && userId in g.summaryOptedIn;
    if (g.summaryOptedIn) delete g.summaryOptedIn[userId];
    if (g.summaries) delete g.summaries[userId];
    if (g.channelSummaries) delete g.channelSummaries[userId];
    this.save();
    return was;
  }

  isSummaryOptedIn(guildId: string, userId: string): boolean {
    return !!this.guild(guildId).summaryOptedIn?.[userId];
  }

  getSummary(guildId: string, userId: string, channelId?: string): SummaryEntry | undefined {
    const g = this.guild(guildId);
    return isCurrent(channelId ? g.channelSummaries?.[userId]?.[channelId] : g.summaries?.[userId]);
  }

  setSummary(guildId: string, userId: string, entry: SummaryEntry, channelId?: string): void {
    const g = this.guild(guildId);
    if (!this.isSummaryOptedIn(guildId, userId)) return;
    const stamped = { ...entry, sampleVersion: SAMPLE_VERSION };
    if (channelId) {
      g.channelSummaries ??= {};
      g.channelSummaries[userId] ??= {};
      g.channelSummaries[userId][channelId] = stamped;
    } else {
      g.summaries ??= {};
      g.summaries[userId] = stamped;
    }
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
