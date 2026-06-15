// WeChat per-account (wxid_*) filter. Only mounted when matches[] actually
// contain a wxid_ subdir, so the prop is "wxids is non-empty" by construction.

import type { Dispatch, SetStateAction } from 'react';
import clsx from 'clsx';

interface Props {
  wxids: string[];
  selectedWxids: Set<string>;
  setSelectedWxids: Dispatch<SetStateAction<Set<string>>>;
  disabled: boolean;
}

export function WxidFilter({ wxids, selectedWxids, setSelectedWxids, disabled }: Props) {
  return (
    <section className="cleanup-section">
      <div className="cleanup-section-head">
        <span>账号</span>
        <span className="muted small">只清勾选账号下的文件 · 跨账号目录不受影响</span>
      </div>
      <div className="cleanup-wxid-grid">
        {wxids.map((w) => {
          const checked = selectedWxids.has(w);
          return (
            <label key={w} className="cleanup-wxid-chip">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  setSelectedWxids((prev) => {
                    const next = new Set(prev);
                    if (next.has(w)) next.delete(w);
                    else next.add(w);
                    return next;
                  });
                }}
              />
              <span className={clsx(checked || 'muted')}>{w}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}