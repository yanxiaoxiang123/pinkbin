// Two-step dry-run confirmation. First click arms (5s), second click
// hands onConfirm to ProgressButton which actually drives the delete.
// The arm timer is intentionally NOT cleared on click — instead it's
// cleared inside runDelete so a slow clean (>5s) can't accidentally
// re-arm if the user mashes the button.

import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { formatBytes } from '../../format';
import { ProgressButton } from '../ProgressButton';
import type { DryRunPreview } from './types';

interface Props {
  preview: DryRunPreview;
  running: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  estimatedCount: number;
  granularity: 'file' | 'directory';
}

export function DryRunPreviewDialog({
  preview,
  running,
  onConfirm,
  onCancel,
  estimatedCount,
  granularity,
}: Props) {
  const [armed, setArmed] = useState(false);
  const armTimeoutRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (armTimeoutRef.current !== null) window.clearTimeout(armTimeoutRef.current);
  }, []);
  const armClick = () => {
    if (running || armed) return;
    setArmed(true);
    if (armTimeoutRef.current !== null) window.clearTimeout(armTimeoutRef.current);
    armTimeoutRef.current = window.setTimeout(() => {
      armTimeoutRef.current = null;
      setArmed(false);
    }, 5000);
  };
  // Hand onConfirm directly to ProgressButton. Do NOT setArmed(false) here:
  // armed → false would re-render this dialog into the unarmed branch,
  // unmounting ProgressButton mid-flight and losing its progress state.
  // Cancel the auto-disarm timer though, so a slow clean (>5s) can't trip it.
  const runDelete = async () => {
    if (armTimeoutRef.current !== null) {
      window.clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
    await onConfirm();
  };
  return (
    <div className="modal-bg" onClick={onCancel} style={{ zIndex: 60 }}>
      <div className="modal cleanup-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>预览：将删除以下文件</div>
          <button className="ghost icon" onClick={onCancel} disabled={running}>
            <X size={16} />
          </button>
        </div>

        <div className="cleanup-preview-summary">
          <strong>{preview.totalFiles.toLocaleString()}</strong> 个文件 · 共 <strong>{formatBytes(preview.totalBytes)}</strong>
          <span className="muted small" style={{ marginLeft: 10 }}>
            进系统回收站，可右键还原
          </span>
        </div>

        <div className="cleanup-preview-list">
          {preview.samplePaths.map((p) => (
            <div key={p} className="cleanup-preview-path" title={p}>{p}</div>
          ))}
          {preview.truncated && (
            <div className="cleanup-preview-more muted small">
              … 还有 {(preview.totalFiles - preview.samplePaths.length).toLocaleString()} 个未列出
            </div>
          )}
        </div>

        <p className="cleanup-disclaimer">
          <AlertTriangle size={12} /> 仔细看一眼上面的路径，确认没有你想留的东西。回收站默认 30 天后自动清空。
        </p>

        <div className="cleanup-footer">
          <div className="cleanup-summary muted small">
            {armed ? '5 秒内再点一次真删' : '点确认进入预备状态，再点一次才真删'}
          </div>
          <div className="cleanup-actions">
            <button className="ghost" onClick={onCancel} disabled={running}>返回</button>
            {armed ? (
              <ProgressButton
                className="primary cleanup-execute armed"
                estimatedCount={estimatedCount}
                granularity={granularity}
                mode="recycle"
                onAction={runDelete}
                idleContent={<><Trash2 size={13} /> 再点真删</>}
              />
            ) : (
              <button
                type="button"
                className="primary cleanup-execute"
                onClick={armClick}
                disabled={running}
              >
                {running
                  ? <><Loader2 size={13} className="spin" /> 清理中…</>
                  : <><Trash2 size={13} /> 确认删除</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}