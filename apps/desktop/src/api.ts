import { invoke } from '@tauri-apps/api/core';
import type {
  Node,
  Scaffold,
  AdvisorRequest,
  AdvisorResponse,
  UndoEntry,
  ScopeMatch,
  CondaEnv,
  SteamInventory,
  WorkshopItem,
} from './types';
import { isTauri } from './env';
import * as mocks from './mocks';

type ScopeSizeRow = { scope_id: string; bytes: number; file_count: number; total_bytes: number; total_files: number };
type VolumeInfo = { total_bytes: number; used_bytes: number; free_bytes: number };
type AdvisorProvider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
type SteamUrlAction = 'uninstall' | 'rungameid' | 'validate' | 'nav' | 'workshop_page';

// One definition per method, per runtime. The Proxy below dispatches at
// access time so each call site just writes `api.foo(...)` — no inline
// `isTauri ? ... : ...` ternaries spread across 17 methods.
const tauri = {
  scan: (path: string) => invoke<Node>('scan_path', { path }),
  listScaffolds: () => invoke<Scaffold[]>('list_scaffolds'),
  detectScaffold: (path: string) => invoke<string | null>('detect_scaffold', { path }),
  scopeSizes: (scaffoldId: string, rootPath: string, scopeDays?: Record<string, number>, wxidFilter?: string[], envFilter?: string[]) =>
    invoke<ScopeSizeRow[]>('scope_sizes', { scaffoldId, rootPath, scopeDays: scopeDays ?? null, wxidFilter: wxidFilter ?? null, envFilter: envFilter ?? null }),
  executeScope: (scaffoldId: string, scopeId: string, rootPath: string, dryRun: boolean, olderThanDays?: number, wxidFilter?: string[], envFilter?: string[]) =>
    invoke<UndoEntry[]>('execute_scope', { scaffoldId, scopeId, rootPath, dryRun, olderThanDays: olderThanDays ?? null, wxidFilter: wxidFilter ?? null, envFilter: envFilter ?? null }),
  listCondaEnvs: (condaRoot: string) => invoke<CondaEnv[]>('list_conda_envs', { condaRoot }),
  advise: (req: AdvisorRequest) => invoke<AdvisorResponse>('advise', { req }),
  inspect: (path: string, sampleCount: number) => invoke<string[]>('inspect_path', { path, sampleCount }),
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
  // Tauri return is `VolumeInfo` but the browser fallback returns null when
  // the path doesn't exist on a volume, so the union lives on the canonical
  // type and the tauri side declares it honestly.
  volumeInfo: (path: string) => invoke<VolumeInfo | null>('volume_info', { path }),
  estimateSize: (path: string) => invoke<number>('estimate_size', { path }),
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
};

// Browser-mode secret store: a module-scoped Map, in-memory only. The
// dev preview never persists to localStorage, matching the Tauri
// behaviour (no plaintext on disk). Refresh the tab and the key is gone.
const browserSecretStore: Map<string, string> = new Map();

const browser = {
  scan: (path: string) => mocks.scan(path),
  listScaffolds: () => Promise.resolve(mocks.SCAFFOLDS),
  detectScaffold: (path: string) => mocks.detectScaffold(path),
  scopeSizes: (_scaffoldId: string, _rootPath: string, _scopeDays?: Record<string, number>, _wxidFilter?: string[], _envFilter?: string[]) =>
    mocks.scopeSizes(_scaffoldId, _rootPath),
  executeScope: (_scaffoldId: string, _scopeId: string, _rootPath: string, _dryRun: boolean, _olderThanDays?: number, _wxidFilter?: string[], _envFilter?: string[]) =>
    Promise.resolve([] as UndoEntry[]),
  listCondaEnvs: (_condaRoot: string) => Promise.resolve([] as CondaEnv[]),
  advise: (req: AdvisorRequest) => mocks.advise(req),
  inspect: (path: string, sampleCount: number) => mocks.inspect(path, sampleCount),
  revealInExplorer: () => Promise.resolve(),
  setAdvisor: (_provider: AdvisorProvider, _model: string, _baseUrl?: string) => Promise.resolve(),
  storeSecret: (_account: string, secret: string) => {
    // No-op if the caller doesn't pass an account (shouldn't happen in
    // practice). We use a singleton account name in browser mode.
    browserSecretStore.set('pinkbin:advisor-key', secret);
    return Promise.resolve();
  },
  loadSecret: (_account: string) =>
    Promise.resolve(browserSecretStore.get('pinkbin:advisor-key') ?? null),
  deleteSecret: (_account: string) => {
    browserSecretStore.delete('pinkbin:advisor-key');
    return Promise.resolve();
  },
  execute: (_scaffoldId: string, _scopeId: string, paths: string[], reason: string, _dryRun: boolean) =>
    mocks.execute(_scaffoldId, _scopeId, paths, reason, _dryRun),
  findScopeForPath: (path: string) => mocks.findScopeForPath(path),
  volumeInfo: () => Promise.resolve(null),
  estimateSize: () => Promise.resolve(0),
  listSteamGames: () => Promise.resolve(mocks.STEAM_INVENTORY),
  listSteamWorkshopItems: (_libraryRoot: string, appid: number) => Promise.resolve(mocks.steamWorkshopItems(appid)),
  fetchWorkshopTitles: (ids: number[]) => Promise.resolve(mocks.workshopTitles(ids)),
  openSteamUrl: () => Promise.resolve(),
};

type Api = typeof tauri;
const browserTyped: Api = browser;

export const api: Api = new Proxy(tauri, {
  get(target, key) {
    if (isTauri) return (target as Api)[key as keyof Api];
    return browserTyped[key as keyof Api];
  },
}) as Api;