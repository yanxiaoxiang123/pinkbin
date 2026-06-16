import { invoke } from '@tauri-apps/api/core';

/** Extract a human-readable message from a Tauri command error.
 *  Commands now return `Result<T, CommandError>` which serializes as
 *  `{ kind, message }`.  The frontend historically used `String(e)` on
 *  raw-string errors; this helper bridges both shapes. */
export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

import type {
  Node,
  Scaffold,
  AdvisorRequest,
  AdvisorResponse,
  UndoEntry,
  ScopeMatch,
  ScopeSize,
  CondaEnv,
  SteamInventory,
  WorkshopItem,
} from './types';
import { isTauri } from './env';

// Lazy-loaded only in browser mode — Vite code-splits this into a separate
// chunk that is never fetched in Tauri production builds.
const getMocks = () => import('./mocks');

type VolumeInfo = { total_bytes: number; used_bytes: number; free_bytes: number };
type AdvisorProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
type SteamUrlAction = 'uninstall' | 'rungameid' | 'validate' | 'nav' | 'workshop_page';

// One definition per method, per runtime. The Proxy below dispatches at
// access time so each call site just writes `api.foo(...)` — no inline
// `isTauri ? ... : ...` ternaries spread across 17 methods.
const tauri = {
  scan: (path: string, scanId?: string) => invoke<Node>('scan_path', { path, scanId: scanId ?? null }),
  listScaffolds: () => invoke<Scaffold[]>('list_scaffolds'),
  getAppVersion: () => invoke<string>('get_app_version'),
  scopeSizes: (scaffoldId: string, rootPath: string, scopeDays?: Record<string, number>, wxidFilter?: string[], envFilter?: string[]) =>
    invoke<ScopeSize[]>('scope_sizes', { scaffoldId, rootPath, scopeDays: scopeDays ?? null, wxidFilter: wxidFilter ?? null, envFilter: envFilter ?? null }),
  executeScope: (scaffoldId: string, scopeId: string, rootPath: string, dryRun: boolean, olderThanDays?: number, wxidFilter?: string[], envFilter?: string[], jobId?: string) =>
    invoke<UndoEntry[]>('execute_scope', { scaffoldId, scopeId, rootPath, dryRun, olderThanDays: olderThanDays ?? null, wxidFilter: wxidFilter ?? null, envFilter: envFilter ?? null, jobId: jobId ?? null }),
  listCondaEnvs: (condaRoot: string) => invoke<CondaEnv[]>('list_conda_envs', { condaRoot }),
  advise: (req: AdvisorRequest) => invoke<AdvisorResponse>('advise', { req }),
  revealInExplorer: (path: string) => invoke<void>('reveal_in_explorer', { path }),
  // `execute` requires a scaffold_id + scope_id; the backend re-validates
  // every path against the scope's compiled glob, so callers cannot bypass
  // the scaffold red-line by passing arbitrary paths. The final action
  // (recycle/quarantine/delete) is derived from the scope's declared mode,
  // not from the caller.
  execute: (scaffoldId: string, scopeId: string, paths: string[], reason: string, dryRun: boolean) =>
    invoke<UndoEntry[]>('execute_plan', { scaffoldId, scopeId, paths, reason, dryRun }),
  // Look up which scopes (across all loaded scaffolds) own a path. Used by
  // the chat panel to discover the right scaffold+scope to pass to execute.
  findScopeForPath: (path: string) =>
    invoke<ScopeMatch[]>('find_scope_for_path', { path }),
  cancelJob: (jobId: string) => invoke<void>('cancel_job', { jobId }),
  pruneQuarantine: (ttlDays: number) => invoke<{ removed_count: number; removed_bytes: number }>('prune_quarantine_cmd', { ttlDays }),
  // Tauri return is `VolumeInfo` but the browser fallback returns null when
  // the path doesn't exist on a volume, so the union lives on the canonical
  // type and the tauri side declares it honestly.
  volumeInfo: (path: string) => invoke<VolumeInfo | null>('volume_info', { path }),
  // `setAdvisor` no longer takes the API key — it's read from the OS
  // credential store on the backend side. The frontend stores the key via
  // `storeSecret` (and clears it with `deleteSecret`).
  setAdvisor: (provider: AdvisorProvider, model: string, baseUrl?: string) =>
    invoke<void>('set_advisor', { provider, model, baseUrl: baseUrl ?? null }),
  // Keyring-backed secret store. The key only ever lives in
  // `app.keyring()` (Windows Credential Manager / macOS Keychain / Linux
  // libsecret), never in the webview's localStorage.
  storeSecret: (account: string, secret: string) =>
    invoke<void>('store_secret', { account, secret }),
  loadSecret: (account: string) => invoke<string | null>('load_secret', { account }),
  deleteSecret: (account: string) => invoke<void>('delete_secret', { account }),
  listSteamGames: () => invoke<SteamInventory>('list_steam_games'),
  listSteamWorkshopItems: (libraryRoot: string, appid: number) =>
    invoke<WorkshopItem[]>('list_steam_workshop_items', { libraryRoot, appid }),
  fetchWorkshopTitles: (ids: number[]) => invoke<Record<number, string>>('fetch_workshop_titles', { ids }),
  openSteamUrl: (action: SteamUrlAction, appid: number) => invoke<void>('open_steam_url', { action, appid }),
  lastUndoEntry: () => invoke<UndoEntry | null>('last_undo_entry'),
  openRecycleBin: () => invoke<void>('open_recycle_bin'),
};

// Browser-mode secret store: a module-scoped Map, in-memory only. The
// dev preview never persists to localStorage, matching the Tauri
// behaviour (no plaintext on disk). Refresh the tab and the key is gone.
const browserSecretStore: Map<string, string> = new Map();

const browser = {
  scan: async (_path: string, _scanId?: string) => (await getMocks()).scan(_path),
  listScaffolds: async () => (await getMocks()).SCAFFOLDS,
  getAppVersion: () => Promise.resolve('0.0.0'),
  scopeSizes: async (_scaffoldId: string, _rootPath: string, _scopeDays?: Record<string, number>, _wxidFilter?: string[], _envFilter?: string[]) =>
    (await getMocks()).scopeSizes(_scaffoldId, _rootPath),
  executeScope: (_scaffoldId: string, _scopeId: string, _rootPath: string, _dryRun: boolean, _olderThanDays?: number, _wxidFilter?: string[], _envFilter?: string[]) =>
    Promise.resolve([] as UndoEntry[]),
  listCondaEnvs: (_condaRoot: string) => Promise.resolve([] as CondaEnv[]),
  advise: async (req: AdvisorRequest) => (await getMocks()).advise(req),
  revealInExplorer: () => Promise.resolve(),
  setAdvisor: (_provider: AdvisorProvider, _model: string, _baseUrl?: string) => Promise.resolve(),
  storeSecret: (_account: string, secret: string) => {
    browserSecretStore.set('pinkbin:advisor-key', secret);
    return Promise.resolve();
  },
  loadSecret: (_account: string) =>
    Promise.resolve(browserSecretStore.get('pinkbin:advisor-key') ?? null),
  deleteSecret: (_account: string) => {
    browserSecretStore.delete('pinkbin:advisor-key');
    return Promise.resolve();
  },
  execute: async (_scaffoldId: string, _scopeId: string, paths: string[], reason: string, _dryRun: boolean) =>
    (await getMocks()).execute(_scaffoldId, _scopeId, paths, reason, _dryRun),
  findScopeForPath: async (path: string) => (await getMocks()).findScopeForPath(path),
  volumeInfo: () => Promise.resolve(null),
  listSteamGames: async () => (await getMocks()).STEAM_INVENTORY,
  listSteamWorkshopItems: async (_libraryRoot: string, appid: number) => (await getMocks()).steamWorkshopItems(appid),
  fetchWorkshopTitles: async (ids: number[]) => (await getMocks()).workshopTitles(ids),
  openSteamUrl: () => Promise.resolve(),
  cancelJob: (_jobId: string) => Promise.resolve(),
  pruneQuarantine: (_ttlDays: number) => Promise.resolve({ removed_count: 0, removed_bytes: 0 }),
  lastUndoEntry: () => Promise.resolve(null),
  openRecycleBin: () => Promise.resolve(),
};

type Api = typeof tauri;
const browserTyped: Api = browser;

export const api: Api = new Proxy(tauri, {
  get(target, key) {
    if (isTauri) return (target as Api)[key as keyof Api];
    return browserTyped[key as keyof Api];
  },
}) as Api;