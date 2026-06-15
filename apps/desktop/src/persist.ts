// Single source of truth for app-side localStorage. All reads/writes go
// through here so key names, JSON shape, and schema migrations live in one
// place. Callers should never touch `localStorage` directly — if you find
// yourself reaching for it, add a typed helper here first.

export const NAMESPACE = 'pinkbin.';
export const STORAGE_VERSION = 1;
const VERSION_KEY = `${NAMESPACE}_version`;

export type StorageKey =
  | 'hideStudio'
  | 'leftWidth'
  | 'rightWidth'
  | 'scopeDays'
  | 'advisor'
  | 'workshopTitles'
  | 'studioExpanded';

export function fullKey(key: StorageKey): string {
  return NAMESPACE + key;
}

function readRaw(key: StorageKey): string | null {
  try {
    return localStorage.getItem(fullKey(key));
  } catch {
    return null;
  }
}

function writeRaw(key: StorageKey, value: string): boolean {
  try {
    localStorage.setItem(fullKey(key), value);
    return true;
  } catch {
    return false;
  }
}

export function getBool(key: StorageKey, fallback: boolean): boolean {
  const v = readRaw(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

export function setBool(key: StorageKey, value: boolean): void {
  writeRaw(key, value ? '1' : '0');
}

export function getNumber(key: StorageKey, fallback: number): number {
  const v = readRaw(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function setNumber(key: StorageKey, value: number): void {
  writeRaw(key, String(value));
}

export function getJson<T>(key: StorageKey, fallback: T): T {
  const v = readRaw(key);
  if (v === null) return fallback;
  try {
    const parsed = JSON.parse(v) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function setJson<T>(key: StorageKey, value: T): void {
  writeRaw(key, JSON.stringify(value));
}

export function removeKey(key: StorageKey): void {
  try {
    localStorage.removeItem(fullKey(key));
  } catch {
    /* private mode / quota */
  }
}

export function ensureMigrated(): void {
  let current = 0;
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) current = n;
    }
  } catch {
    return;
  }
  if (current === STORAGE_VERSION) return;
  migrate(current, STORAGE_VERSION);
  try {
    localStorage.setItem(VERSION_KEY, String(STORAGE_VERSION));
  } catch {
    /* ignore */
  }
}

// Chain migrations by (from, to). Bump STORAGE_VERSION above and add a
// branch here when the on-disk shape changes.
function migrate(_from: number, _to: number): void {
  // no migrations yet — schema is unchanged from initial centralization
}