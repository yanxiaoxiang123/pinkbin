// Cleanup modal — orchestrates scope loading, day/wxid/env filters, and
// the two-step arm → dry-run → real-delete flow. Sub-components live next
// to this file in the same folder; the scope-sizes fetch is in `hooks`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import FocusTrap from 'focus-trap-react';
import { X, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { formatBytes } from '../../format';
import type { Node, Scaffold, CondaEnv } from '../../types';
import { CondaPicker } from './CondaPicker';
import { DryRunPreviewDialog } from './DryRunPreviewDialog';
import { ScopeGroup } from './ScopeGroup';
import { WxidFilter } from './WxidFilter';
import {
  detectVariants,
  useScopeDays,
  useScopeSizes,
  type ScopeSizesFilters,
} from './hooks';
import { DRY_RUN_SAMPLE_CAP, type DryRunPreview, type ScopeSize } from './types';

export type { DryRunPreview, ScopeSize } from './types';

interface Props {
  scaffold: Scaffold;
  matches: Node[];
  onClose: () => void;
  onCleaned: (bytes: number) => void;
}

export function CleanupModal({ scaffold: sc, matches, onClose, onCleaned }: Props) {
  const isConda = sc.id === 'conda';

  // ── Days inputs (per-scope, persisted across sessions) ──
  const defaultDays = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const scope of sc.scopes ?? []) {
      if (scope.prompt?.kind === 'days') out[scope.id] = scope.prompt.default;
    }
    return out;
  }, [sc.scopes]);
  const [daysByScope, setDaysByScope] = useScopeDays(sc.id, defaultDays);

  // ── WeChat: per-account (wxid_*) filter ──
  const wxids = useMemo<string[]>(() => {
    const out = new Set<string>();
    for (const m of matches) {
      for (const c of m.children ?? []) {
        if (c.is_dir && c.name.startsWith('wxid_')) out.add(c.name);
      }
    }
    return [...out].sort();
  }, [matches]);
  const [selectedWxids, setSelectedWxids] = useState<Set<string>>(() => new Set(wxids));
  // Use a separator that can't appear in path segments so the joined key is
  // a real Set fingerprint. `|` collides: ["a|", "b"] and ["a", "|b"] both
  // serialize to "a||b" and would skip a needed effect re-run.
  const wxidsKey = useMemo(() => wxids.join('\0'), [wxids]);
  useEffect(() => { setSelectedWxids(new Set(wxids)); }, [wxidsKey]);
  const wxidFilterArg = wxids.length > 0 && selectedWxids.size < wxids.length
    ? [...selectedWxids]
    : undefined;

  // ── Conda: env picker ──
  const [condaEnvs, setCondaEnvs] = useState<CondaEnv[] | null>(null);
  const [condaEnvsLoading, setCondaEnvsLoading] = useState(false);
  const [selectedEnvs, setSelectedEnvs] = useState<Set<string>>(new Set());

  // ── Scope sizes (live preview, refetched when filters change) ──
  const scopeFilters: ScopeSizesFilters = { daysByScope, wxidFilter: wxidFilterArg };
  const { sizes: scopeSizes, loading: scopeLoading, error: scopeSizesError, refresh: refreshScopeSizes } = useScopeSizes(
    sc.id,
    matches,
    scopeFilters,
    !isConda,
  );

  // ── Which scopes are checked for cleanup ──
  const detectedVariants = useMemo(() => detectVariants(matches), [matches]);
  const visibleScopes = useMemo(
    () => (sc.scopes ?? []).filter((s) => !s.variant || detectedVariants.has(s.variant)),
    [sc.scopes, detectedVariants],
  );
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set());

  // ── Execute state ──
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [armed, setArmed] = useState(false);
  const [armedSeconds, setArmedSeconds] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const armIntervalRef = useRef<number | null>(null);

  // Clear arm countdown on unmount.
  useEffect(() => () => {
    if (armIntervalRef.current !== null) window.clearInterval(armIntervalRef.current);
  }, []);

  // Cancel an in-flight deletion when the modal closes or unmounts.
  const cancelJob = useCallback(() => {
    if (jobIdRef.current) {
      api.cancelJob(jobIdRef.current).catch(() => {});
      jobIdRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    cancelJob();
    onClose();
  }, [cancelJob, onClose]);

  const matchKey = matches.map((m) => m.path).sort().join('|');

  // Cancel in-flight deletion on unmount.
  useEffect(() => cancelJob, [cancelJob]);

  // Load conda envs.
  useEffect(() => {
    if (!isConda || matches.length === 0) return;
    let cancelled = false;
    setCondaEnvsLoading(true);
    api
      .listCondaEnvs(matches[0].path)
      .then((envs) => {
        if (cancelled) return;
        setCondaEnvs(envs);
        setSelectedEnvs(new Set(envs.filter((e) => e.default_checked).map((e) => e.name)));
      })
      .catch((e) => { if (!cancelled) setErr(`读取 conda env 失败：${String(e)}`); })
      .finally(() => { if (!cancelled) setCondaEnvsLoading(false); });
    return () => { cancelled = true; };
  }, [isConda, matchKey, matches, setCondaEnvs, setSelectedEnvs, setCondaEnvsLoading, setErr]);

  // Bubble scope-sizes fetch errors into the modal's err banner.
  useEffect(() => {
    if (scopeSizesError) setErr(scopeSizesError);
  }, [scopeSizesError]);

  // Bytes / files for a scope from current sizes. `bytes` and `filesForScope`
  // honor the days filter (i.e. they describe what would actually be cleaned).
  // `totalBytes` / `totalFiles` ignore the days filter — used to show users
  // "you have 12 GB of videos · 0 GB exceed retention" instead of just "空".
  const sizesById = useMemo(() => {
    const m = new Map<string, ScopeSize>();
    for (const r of scopeSizes ?? []) m.set(r.scope_id, r);
    return m;
  }, [scopeSizes]);
  const bytesForScope = (id: string) => sizesById.get(id)?.bytes ?? 0;

  const sortedMediaScopes = useMemo(() => {
    const list = visibleScopes.filter((s) => s.category === 'media');
    return [...list].sort((a, b) => bytesForScope(b.id) - bytesForScope(a.id));
  }, [visibleScopes, sizesById]);

  const cacheScopes = visibleScopes.filter((s) => (s.category ?? 'cache') === 'cache');
  const backupScopes = visibleScopes.filter((s) => s.category === 'backup');

  const toggleScope = (id: string) => {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleScopeGroup = (group: typeof visibleScopes) => {
    const ids = group.map((s) => s.id);
    const allOn = ids.every((id) => selectedScopes.has(id));
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => { if (bytesForScope(id) > 0) next.add(id); });
      return next;
    });
  };

  // ── Total bytes for the cleanup button label ──
  const totalSelected = useMemo(() => {
    if (isConda) {
      let count = 0;
      let bytes = 0;
      if (condaEnvs) {
        for (const e of condaEnvs) {
          if (selectedEnvs.has(e.name)) { count += 1; bytes += e.size_bytes; }
        }
      }
      return { count, bytes };
    }
    let count = 0;
    let bytes = 0;
    for (const id of selectedScopes) {
      const b = bytesForScope(id);
      if (b > 0) { count += 1; bytes += b; }
    }
    return { count, bytes };
  }, [isConda, selectedEnvs, condaEnvs, selectedScopes, sizesById]);

  // ── Execute ──
  const execute = async () => {
    if (running) return;
    if (!armed) {
      setArmed(true);
      setArmedSeconds(5);
      setMsg(null);
      if (armIntervalRef.current !== null) window.clearInterval(armIntervalRef.current);
      armIntervalRef.current = window.setInterval(() => {
        setArmedSeconds((s) => {
          if (s <= 1) {
            window.clearInterval(armIntervalRef.current!);
            armIntervalRef.current = null;
            setArmed(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return;
    }
    if (armIntervalRef.current !== null) {
      window.clearInterval(armIntervalRef.current);
      armIntervalRef.current = null;
    }
    setArmed(false);
    setArmedSeconds(0);
    if (preview === null) {
      // Two-step: first click after arming runs dry-run + opens preview
      // dialog. The user must explicitly confirm IN the dialog to actually
      // delete. Without this users were silent-deleting based on a misleading
      // size pill ("空" used to mean "everything was wiped" — actually meant
      // "nothing exceeds retention").
      await runDryRun();
      return;
    }
    await runRealDelete();
  };

  const runDryRun = async () => {
    setPreviewing(true);
    setMsg(null);
    setErr(null);
    try {
      const samplePaths: string[] = [];
      let totalBytes = 0;
      let totalFiles = 0;
      let scopeIds: string[] = [];

      if (isConda) {
        if (selectedEnvs.size === 0 || matches.length === 0) {
          setErr('没有勾选任何 environment');
          return;
        }
        scopeIds = ['envs-stale'];
        const entries = await api.executeScope(
          sc.id, 'envs-stale', matches[0].path, true,
          undefined, undefined, [...selectedEnvs],
        );
        for (const e of entries) {
          totalFiles += 1;
          if (samplePaths.length < DRY_RUN_SAMPLE_CAP) samplePaths.push(e.source);
        }
        totalBytes = totalSelected.bytes;
      } else {
        scopeIds = [...selectedScopes].filter((id) => bytesForScope(id) > 0);
        if (scopeIds.length === 0) {
          setErr('没有勾选任何要清理的 scope');
          return;
        }
        totalBytes = scopeIds.reduce((s, id) => s + bytesForScope(id), 0);
        const tasks: Promise<{ source: string }[]>[] = [];
        for (const scopeId of scopeIds) {
          const days = daysByScope[scopeId];
          for (const m of matches) {
            tasks.push(
              api.executeScope(sc.id, scopeId, m.path, true, days, wxidFilterArg).catch((e) => {
                console.warn(`[pinkbin] dry-run ${sc.id}/${scopeId} on ${m.path} failed:`, e);
                return [] as { source: string }[];
              }),
            );
          }
        }
        const lists = await Promise.all(tasks);
        for (const list of lists) {
          for (const e of list) {
            totalFiles += 1;
            if (samplePaths.length < DRY_RUN_SAMPLE_CAP) samplePaths.push(e.source);
          }
        }
      }

      if (totalFiles === 0) {
        setErr('预览结果为空 · 没有可清理的文件（可能都在保留期内）');
        return;
      }

      setPreview({
        scopeIds,
        totalBytes,
        totalFiles,
        samplePaths,
        truncated: totalFiles > samplePaths.length,
      });
    } catch (e) {
      setErr(`预览失败：${String(e)}`);
    } finally {
      setPreviewing(false);
    }
  };

  const cancelPreview = () => {
    cancelJob();
    setPreview(null);
    setArmed(false);
    setArmedSeconds(0);
    if (armIntervalRef.current !== null) {
      window.clearInterval(armIntervalRef.current);
      armIntervalRef.current = null;
    }
  };

  const runRealDelete = async () => {
    if (preview === null) return;
    // Generate a unique job ID that ties all concurrent executeScope calls
    // together — cancel_job with this ID stops every in-flight call at once.
    const jobId = crypto.randomUUID();
    jobIdRef.current = jobId;
    setRunning(true);
    setMsg(null);
    setErr(null);
    try {
      let totalEntries = 0;

      if (isConda) {
        const envFilterArg = [...selectedEnvs];
        const entries = await api.executeScope(
          sc.id, 'envs-stale', matches[0].path, false,
          undefined, undefined, envFilterArg, jobId,
        );
        totalEntries = entries.length;
        const refreshed = await api.listCondaEnvs(matches[0].path).catch(() => [] as CondaEnv[]);
        setCondaEnvs(refreshed);
        setSelectedEnvs(new Set(refreshed.filter((e) => e.default_checked).map((e) => e.name)));
      } else {
        const tasks: Promise<unknown>[] = [];
        for (const scopeId of preview.scopeIds) {
          const days = daysByScope[scopeId];
          for (const m of matches) {
            tasks.push(
              api.executeScope(sc.id, scopeId, m.path, false, days, wxidFilterArg, undefined, jobId).then(
                (entries) => { totalEntries += entries.length; },
                (e) => { console.warn(`[pinkbin] executeScope ${sc.id}/${scopeId} on ${m.path} failed:`, e); },
              ),
            );
          }
        }
        await Promise.all(tasks);
        setSelectedScopes(new Set());
        refreshScopeSizes();
      }

      onCleaned(preview.totalBytes);
      setMsg(`已清理 ${totalEntries} 个文件 · 约 ${formatBytes(preview.totalBytes)} · 进了系统回收站`);
      setPreview(null);
    } catch (e) {
      setErr(`清理失败：${String(e)}`);
      throw e;
    } finally {
      jobIdRef.current = null;
      setRunning(false);
    }
  };

  // Small state echo so the post-delete size refetch shows up immediately
  // without forcing the user to touch the filter controls. The hook owns
  // its own copy of the rows; this just feeds the lookup map the modal
  // uses for the totalSelected label and the rows' size pills.
  const canExecute = !running && !previewing && !preview && totalSelected.count > 0;

  // ── Coverage breakdown: helps users understand "13 GB total but only 4 GB
  // in scopes" — the rest is red-line content (chat DBs, favorites, account
  // state) that scaffolds INTENTIONALLY don't touch. Only meaningful for
  // non-conda scaffolds where matches[] is the actual disk root.
  const coverageBreakdown = useMemo(() => {
    if (isConda) return null;
    const folderTotal = matches.reduce((s, m) => s + m.size, 0);
    const inScope = (scopeSizes ?? []).reduce((s, r) => s + r.total_bytes, 0);
    if (folderTotal === 0) return null;
    const outsideScope = Math.max(0, folderTotal - inScope);
    return { folderTotal, inScope, outsideScope };
  }, [isConda, matches, scopeSizes]);

  return (
    <div className="modal-bg" onClick={handleClose}>
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
        <div
          className="modal cleanup-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`清理 · ${sc.name}`}
          onClick={(e) => e.stopPropagation()}
        >
        <div className="modal-head">
          <div>
            清理 · {sc.name}
            {scopeLoading && <Loader2 size={13} className="spin" style={{ marginLeft: 8, verticalAlign: 'middle' }} />}
          </div>
          <button className="ghost icon" onClick={handleClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="cleanup-paths">
          {matches.map((m) => (
            <div key={m.path} className="cleanup-path-row" title={m.path}>
              <span className="cleanup-path">{m.path}</span>
              <span className="muted small">{formatBytes(m.size)}</span>
            </div>
          ))}
        </div>

        {coverageBreakdown && coverageBreakdown.outsideScope > 0 && (
          <div className="cleanup-coverage" title="清理脚本只覆盖缓存 / 接收的媒体 / 临时数据。聊天记录、收藏、账号、加密物料属于红线区域，永远不会被任何 scope 命中——这就是 13 GB 总量和 scope 加起来对不上的原因。">
            <div className="cleanup-coverage-row">
              <span>📦 文件夹总计</span>
              <strong>{formatBytes(coverageBreakdown.folderTotal)}</strong>
            </div>
            <div className="cleanup-coverage-row">
              <span>🧹 清理脚本覆盖</span>
              <strong>{formatBytes(coverageBreakdown.inScope)}</strong>
            </div>
            <div className="cleanup-coverage-row protected">
              <span>🔒 红线保护（聊天记录·收藏·账号·加密物料 — 永远不动）</span>
              <strong>{formatBytes(coverageBreakdown.outsideScope)}</strong>
            </div>
          </div>
        )}

        {wxids.length > 0 && (
          <WxidFilter
            wxids={wxids}
            selectedWxids={selectedWxids}
            setSelectedWxids={setSelectedWxids}
            disabled={running}
          />
        )}

        {isConda && (
          <CondaPicker
            condaEnvs={condaEnvs}
            condaEnvsLoading={condaEnvsLoading}
            selectedEnvs={selectedEnvs}
            setSelectedEnvs={setSelectedEnvs}
            disabled={running}
          />
        )}

        {!isConda && (
          <>
            <ScopeGroup
              label="接收的媒体"
              scopes={sortedMediaScopes}
              selectedScopes={selectedScopes}
              toggleScope={toggleScope}
              toggleScopeGroup={() => toggleScopeGroup(sortedMediaScopes)}
              scopeSizes={scopeSizes}
              daysByScope={daysByScope}
              setDaysByScope={setDaysByScope}
              running={running}
            />
            <ScopeGroup
              label="缓存与临时数据"
              scopes={cacheScopes}
              selectedScopes={selectedScopes}
              toggleScope={toggleScope}
              toggleScopeGroup={() => toggleScopeGroup(cacheScopes)}
              scopeSizes={scopeSizes}
              daysByScope={daysByScope}
              setDaysByScope={setDaysByScope}
              running={running}
            />
            <ScopeGroup
              label="聊天备份"
              scopes={backupScopes}
              selectedScopes={selectedScopes}
              toggleScope={toggleScope}
              toggleScopeGroup={() => toggleScopeGroup(backupScopes)}
              scopeSizes={scopeSizes}
              daysByScope={daysByScope}
              setDaysByScope={setDaysByScope}
              running={running}
            />
          </>
        )}

        <p className="cleanup-disclaimer">
          <AlertTriangle size={12} /> {sc.disclaimer}
        </p>

        {msg && <div className="ok">{msg}</div>}
        {err && <div className="error">{err}</div>}

        <div className="cleanup-footer">
          <div className="cleanup-summary">
            {totalSelected.count > 0
              ? <>共 <strong>{totalSelected.count}</strong> 项 · <strong>{formatBytes(totalSelected.bytes)}</strong> · 进系统回收站可还原</>
              : <span className="muted">勾选要清理的项目</span>}
          </div>
          <div className="cleanup-actions">
            <button className="ghost" onClick={handleClose}>取消</button>
            <button
              className={clsx('primary cleanup-execute', armed && 'armed')}
              onClick={execute}
              disabled={!canExecute}
              aria-pressed={armed || undefined}
              title={armed ? `${armedSeconds} 秒内再点一次预览` : '点一次确认，再点一次预览实际会删的文件'}
            >
              {previewing
                ? <><Loader2 size={13} className="spin" /> 预览中…</>
                : running
                  ? <><Loader2 size={13} className="spin" /> 清理中…</>
                  : armed
                    ? <><AlertTriangle size={13} /> ⚠ 再点一次开预览 ({armedSeconds}s)</>
                    : <><Trash2 size={13} /> 预览将清理的文件</>}
            </button>
          </div>
        </div>

        {preview && (
          <DryRunPreviewDialog
            preview={preview}
            running={running}
            onConfirm={runRealDelete}
            onCancel={cancelPreview}
            estimatedCount={isConda ? selectedEnvs.size : preview.totalFiles}
            granularity={isConda ? 'directory' : 'file'}
          />
        )}
        </div>
      </FocusTrap>
    </div>
  );
}