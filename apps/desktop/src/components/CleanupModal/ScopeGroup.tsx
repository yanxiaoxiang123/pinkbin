// One scope group: head label + toggle-all + list of rows. Rows render
// their own days input when scope.prompt.kind === 'days'.

import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { formatBytes } from '../../format';
import type { Scope, ScopeSize } from '../../types';

interface Props {
  label: string;
  scopes: Scope[];
  selectedScopes: Set<string>;
  toggleScope: (id: string) => void;
  toggleScopeGroup: () => void;
  scopeSizes: ScopeSize[] | null;
  daysByScope: Record<string, number>;
  setDaysByScope: Dispatch<SetStateAction<Record<string, number>>>;
  running: boolean;
}

export function ScopeGroup({
  label,
  scopes,
  selectedScopes,
  toggleScope,
  toggleScopeGroup,
  scopeSizes,
  daysByScope,
  setDaysByScope,
  running,
}: Props) {
  const sizesById = useMemo(() => {
    const m = new Map<string, ScopeSize>();
    for (const r of scopeSizes ?? []) m.set(r.scope_id, r);
    return m;
  }, [scopeSizes]);

  const allOn = scopes.every((s) => selectedScopes.has(s.id));
  const someOn = !allOn && scopes.some((s) => selectedScopes.has(s.id));

  if (scopes.length === 0) return null;

  return (
    <section className="cleanup-section">
      <div className="cleanup-section-head">
        <span>{label}</span>
        <button
          type="button"
          className="ghost cleanup-toggle-all"
          onClick={toggleScopeGroup}
          disabled={running}
        >
          {allOn ? '全不选' : someOn ? '全选' : '全选'}
        </button>
      </div>
      <ul className="cleanup-rows">
        {scopes.map((scope) => {
          const sz = sizesById.get(scope.id);
          const bytes = sz?.bytes ?? 0;
          const fileCount = sz?.file_count ?? 0;
          const totalBytes = sz?.total_bytes ?? 0;
          const totalFiles = sz?.total_files ?? 0;
          const eligibleEmpty = scopeSizes !== null && bytes === 0;
          const trulyEmpty = scopeSizes !== null && totalBytes === 0;
          const allWithinRetention = eligibleEmpty && !trulyEmpty;
          const checked = selectedScopes.has(scope.id) && !eligibleEmpty;
          const days = daysByScope[scope.id] ?? (scope.prompt?.kind === 'days' ? scope.prompt.default : undefined);
          const meta = (() => {
            if (scopeSizes === null) return '扫描中…';
            if (trulyEmpty) return '空';
            if (allWithinRetention) {
              return `共 ${formatBytes(totalBytes)} · ${totalFiles.toLocaleString()} 文件 · 全部在保留期内（不会清）`;
            }
            const kept = totalBytes - bytes;
            return (
              `共 ${formatBytes(totalBytes)}${totalFiles ? ` · ${totalFiles.toLocaleString()} 文件` : ''}` +
              ` · 待清 ${formatBytes(bytes)}${fileCount ? ` (${fileCount.toLocaleString()} 文件)` : ''}` +
              (kept > 0 ? ` · 保留 ${formatBytes(kept)}` : '')
            );
          })();
          return (
            <li
              key={scope.id}
              className={
                'cleanup-row' +
                (eligibleEmpty ? ' empty' : '') +
                (allWithinRetention ? ' within-retention' : '') +
                (checked ? ' checked' : '')
              }
            >
              <label className="cleanup-row-main">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={eligibleEmpty || running}
                  onChange={() => toggleScope(scope.id)}
                />
                <div className="cleanup-row-text">
                  <span className="cleanup-row-label">{scope.label}</span>
                  <span className="cleanup-row-meta">{meta}</span>
                </div>
              </label>
              {scope.prompt?.kind === 'days' && (
                <div className="cleanup-row-days">
                  <span>保留最近</span>
                  <input
                    type="number"
                    min={0}
                    value={days ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDaysByScope((prev) => ({ ...prev, [scope.id]: Number.isFinite(v) && v >= 0 ? v : 0 }));
                    }}
                    disabled={running}
                  />
                  <span>天</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}