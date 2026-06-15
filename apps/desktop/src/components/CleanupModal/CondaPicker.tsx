// Conda env picker. Base env is shown as a disabled (不可清) row; user
// envs are checkable, pre-checked when the backend flagged them
// default_checked (90d stale heuristic).

import { Loader2 } from 'lucide-react';
import clsx from 'clsx';
import type { Dispatch, SetStateAction } from 'react';
import { formatBytes } from '../../format';
import type { CondaEnv } from '../../types';
import { formatLastActive } from './hooks';

interface Props {
  condaEnvs: CondaEnv[] | null;
  condaEnvsLoading: boolean;
  selectedEnvs: Set<string>;
  setSelectedEnvs: Dispatch<SetStateAction<Set<string>>>;
  disabled: boolean;
}

export function CondaPicker({
  condaEnvs,
  condaEnvsLoading,
  selectedEnvs,
  setSelectedEnvs,
  disabled,
}: Props) {
  const userEnvs = (condaEnvs ?? []).filter((e) => !e.is_base);
  const baseEnv = (condaEnvs ?? []).find((e) => e.is_base);

  return (
    <section className="cleanup-section">
      <div className="cleanup-section-head">
        <span>Environments</span>
        {condaEnvsLoading && <Loader2 size={11} className="spin" />}
      </div>
      {condaEnvs === null && !condaEnvsLoading && (
        <div className="muted small">读取失败</div>
      )}
      {condaEnvs && (baseEnv || userEnvs.length > 0) && (
        <ul className="cleanup-rows">
          {baseEnv && (
            <li className="cleanup-row empty" title="base 是 conda 安装本身，永不可清。">
              <label className="cleanup-row-main">
                <input type="checkbox" disabled checked={false} />
                <div className="cleanup-row-text">
                  <span className="cleanup-row-label muted">base · 不可清</span>
                  <span className="cleanup-row-meta">
                    {formatBytes(baseEnv.size_bytes)} · {formatLastActive(baseEnv.last_active_ts)}
                  </span>
                </div>
              </label>
            </li>
          )}
          {userEnvs.map((e) => {
            const checked = selectedEnvs.has(e.name);
            return (
              <li key={e.name} className={clsx('cleanup-row', checked && 'checked')} title={e.path}>
                <label className="cleanup-row-main">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      setSelectedEnvs((prev) => {
                        const next = new Set(prev);
                        if (next.has(e.name)) next.delete(e.name);
                        else next.add(e.name);
                        return next;
                      });
                    }}
                  />
                  <div className="cleanup-row-text">
                    <span className="cleanup-row-label">{e.name}</span>
                    <span className="cleanup-row-meta">
                      {formatBytes(e.size_bytes)} · {formatLastActive(e.last_active_ts)}
                      {e.default_checked ? ' · 90 天没动过' : ''}
                    </span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {condaEnvs && userEnvs.length === 0 && (
        <div className="muted small">没有用户 environment（envs/ 为空）</div>
      )}
    </section>
  );
}