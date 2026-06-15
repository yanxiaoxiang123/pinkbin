// One-line scan-timing summary shown under the progress bar after a scan
// finishes. Renders nothing while a scan is in flight (caller gates on
// `!scanning`).

import type { ScanDiag } from '../hooks/useScan';

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function DiagnosticsBar({ diag }: { diag: ScanDiag }) {
  const b = diag.backend;
  const parts: string[] = [];
  if (b) {
    parts.push(`mode=${b.mode}`);
    if (b.mft_attempted) parts.push(`mft=${b.mft_succeeded ? 'ok' : 'fail'}/${fmtMs(b.mft_ms)}`);
    if (b.mode === 'walkdir') {
      parts.push(`walk=${fmtMs(b.walk_ms)}`);
      parts.push(`build_tree=${fmtMs(b.build_tree_ms)}`);
      parts.push(`dirs=${b.dirs_in_acc.toLocaleString()}`);
    }
    parts.push(`scanner=${fmtMs(b.scanner_total_ms)}`);
    parts.push(`tag=${fmtMs(b.tag_ms)}`);
  }
  parts.push(`ipc=${fmtMs(diag.ipcMs)}`);
  parts.push(`setRoot=${fmtMs(diag.setRootMs)}`);
  parts.push(`total=${fmtMs(diag.totalMs)}`);
  return (
    <div className="diag-bar" title="扫描各阶段耗时 — localStorage 开关：pinkbin.hideStudio">
      <span className="diag-label">诊断</span>
      <span className="diag-stats">{parts.join(' · ')}</span>
    </div>
  );
}