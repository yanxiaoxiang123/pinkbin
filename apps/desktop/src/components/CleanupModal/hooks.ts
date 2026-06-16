// Hooks and pure helpers extracted from the old monolithic CleanupModal.
// The scope-sizes hook in particular replaces a debounced effect that
// used to live inline and fire 3-5 parallel IPC round-trips per filter
// change.

import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api';
import { getJson, setJson } from '../../persist';
import type { Node, ScopeSize } from '../../types';

// ── scopeDays persistence ───────────────────────────────────────────────

function readScopeDaysAll(): Record<string, Record<string, number>> {
  return getJson<Record<string, Record<string, number>>>('scopeDays', {});
}

export function useScopeDays(scaffoldId: string, defaults: Record<string, number>) {
  const defaultsKey = JSON.stringify(defaults);
  const [days, setDays] = useState<Record<string, number>>(() => {
    const persisted = readScopeDaysAll()[scaffoldId] ?? {};
    return { ...defaults, ...persisted };
  });

  useEffect(() => {
    const persisted = readScopeDaysAll()[scaffoldId] ?? {};
    setDays({ ...defaults, ...persisted });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaffoldId, defaultsKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const all = readScopeDaysAll();
      const overrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(days)) {
        if (defaults[k] !== v) overrides[k] = v;
      }
      if (Object.keys(overrides).length === 0) {
        delete all[scaffoldId];
      } else {
        all[scaffoldId] = overrides;
      }
      setJson('scopeDays', all);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaffoldId, JSON.stringify(days), defaultsKey]);

  return [days, setDays] as const;
}

// ── scopeSizes: debounced parallel fetch + aggregation ─────────────────

export interface ScopeSizesFilters {
  daysByScope: Record<string, number>;
  wxidFilter?: string[];
}

export interface ScopeSizesState {
  sizes: ScopeSize[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Find the common parent path of all matches. If all matches share an
 * ancestor, a single scope_sizes IPC covers them all instead of N
 * parallel calls each re-walking a subtree.
 */
function commonAncestor(paths: string[]): string | null {
  if (paths.length <= 1) return paths[0] ?? null;
  const sep = '\\';
  const parts = paths.map((p) => p.split(sep));
  const minLen = Math.min(...parts.map((p) => p.length));
  const common: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const seg = parts[0]![i]!;
    if (parts.every((p) => p[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.length > 0 ? common.join(sep) : null;
}

/**
 * Live preview of per-scope sizes for the current filter set. The
 * debounce keeps us from spamming the backend when the user drags the
 * days input; cancellation guards against the previous run landing
 * after the user has already moved on. `refresh()` forces an immediate
 * refetch (used after a real delete to update the size pills).
 */
export function useScopeSizes(
  scaffoldId: string,
  matches: Node[],
  filters: ScopeSizesFilters,
  enabled: boolean,
): ScopeSizesState {
  const matchKey = matches.map((m) => m.path).sort().join('|');
  const daysKey = JSON.stringify(filters.daysByScope);
  const wxidKey = filters.wxidFilter ? filters.wxidFilter.slice().sort().join('|') : '';

  const [sizes, setSizes] = useState<ScopeSize[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping this forces the effect to refetch even when the dep signature
  // (matchKey/daysKey/wxidKey) hasn't changed — used after a real delete
  // so the size pills reflect the post-cleanup state immediately.
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (matches.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      // Use common ancestor for a single IPC instead of per-match fanout.
      // Falls back to per-match if paths share no common prefix.
      const paths = matches.map((m) => m.path);
      const root = commonAncestor(paths);
      const call = root
        ? api.scopeSizes(scaffoldId, root, filters.daysByScope, filters.wxidFilter)
            .then((rows) => [rows])
        : Promise.all(
            paths.map((p) =>
              api.scopeSizes(scaffoldId, p, filters.daysByScope, filters.wxidFilter)
                .catch(() => [] as ScopeSize[]),
            ),
          );
      call
        .then((rowsList) => {
          if (cancelled) return;
          setSizes(aggregateScopeSizes(rowsList));
        })
        .catch((e) => { if (!cancelled) setError(`扫描 scope 大小失败：${errorMessage(e)}`); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, matchKey, scaffoldId, daysKey, wxidKey, refreshNonce]);

  return { sizes, loading, error, refresh: () => setRefreshNonce((n) => n + 1) };
}

export function aggregateScopeSizes(rowsList: ScopeSize[][]): ScopeSize[] {
  const merged = new Map<string, ScopeSize>();
  for (const rows of rowsList) {
    for (const r of rows) {
      const prev = merged.get(r.scope_id);
      if (prev) {
        prev.bytes += r.bytes;
        prev.file_count += r.file_count;
        prev.total_bytes += r.total_bytes;
        prev.total_files += r.total_files;
      } else {
        merged.set(r.scope_id, {
          scope_id: r.scope_id,
          bytes: r.bytes,
          file_count: r.file_count,
          total_bytes: r.total_bytes,
          total_files: r.total_files,
        });
      }
    }
  }
  return [...merged.values()];
}

// ── misc small helpers used by the modal ────────────────────────────────

export function detectVariants(matches: Node[]): Set<string> {
  const out = new Set<string>();
  for (const m of matches) {
    const p = m.path.replace(/\\/g, '/').toLowerCase();
    if (p.includes('xwechat_files') || p.includes('tencent/xwechat')) out.add('4.x');
    if (p.includes('wechat files') || p.includes('tencent/wechat')) out.add('3.x');
  }
  return out;
}

export function formatLastActive(ts: number | null): string {
  if (ts === null) return '从未';
  const now = Math.floor(Date.now() / 1000);
  const diffSecs = Math.max(0, now - ts);
  const days = Math.floor(diffSecs / 86400);
  if (days < 1) return '今天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}