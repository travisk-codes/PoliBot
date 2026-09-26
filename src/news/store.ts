import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface GuildNewsConfig {
  channelId: string;
  /** Local posting time, "HH:MM" 24-hour, in NEWS_TIMEZONE. */
  time: string;
  /** Local date ("YYYY-MM-DD") of the last scheduled post. */
  lastPostedDate?: string;
  /** Links and headlines from recent posts, used to avoid repeats. */
  recentLinks?: string[];
  recentHeadlines?: string[];
}

type StoreData = Record<string, GuildNewsConfig>;

const FILE = resolve(process.env.NEWS_STORE_PATH || 'data/news-config.json');

let cache: StoreData | undefined;

function load(): StoreData {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(FILE, 'utf8')) as StoreData;
    } catch {
      cache = {};
    }
  }
  return cache;
}

function save(): void {
  mkdirSync(dirname(FILE), { recursive: true });
  // Write then rename, so a crash mid-write can't leave a corrupt file.
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(load(), null, 2));
  renameSync(tmp, FILE);
}

export function getConfig(guildId: string): GuildNewsConfig | undefined {
  return load()[guildId];
}

export function allConfigs(): Array<[string, GuildNewsConfig]> {
  return Object.entries(load());
}

export function setConfig(guildId: string, config: GuildNewsConfig): void {
  load()[guildId] = config;
  save();
}

export function updateConfig(guildId: string, patch: Partial<GuildNewsConfig>): void {
  const current = load()[guildId];
  if (!current) return;
  load()[guildId] = { ...current, ...patch };
  save();
}

export function deleteConfig(guildId: string): boolean {
  const data = load();
  if (!(guildId in data)) return false;
  delete data[guildId];
  save();
  return true;
}
