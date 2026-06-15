// Scan lifecycle hook. Owns the scan-progress / scan-stats listeners, the
// round-trip + diag timing, and the setRoot/select side-effects. The
// returned `start` is the only thing the caller needs to wire to the
// "扫描" button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from '../api';
import { isTauri } from '../env';
import { useStore } from '../store';

export interface ScanProgress {
  files: number;
  bytes: number;
  path: string;
}

export interface ScanStatsEvent {
  mode: string;
  mft_attempted: boolean;
  mft_succeeded: boolean;
  mft_ms: number;
  walk_ms: number;
  build_tree_ms: number;
  scanner_total_ms: number;
  tag_ms: number;
  cmd_total_ms: number;
  files_seen: number;
  bytes_seen: number;
  dirs_in_acc: number;
}

export interface ScanDiag {
  backend: ScanStatsEvent | null;
  ipcMs: number | null;
  scanCallMs: number;
  setRootMs: number;
  totalMs: number;
}

function isDriveRoot(p: string): boolean {
  // C: / C:\ — anything beyond is a subfolder. Pinkbin only runs on
  // Windows so case-insensitivity here is unnecessary; matches what
  // Windows itself reports via GetVolumeInformationW.
  return /^[A-Z]:\\?$/.test(p);
}

export function useScan(pickedPath: string) {
  const setRoot = useStore((s) => s.setRoot);
  const select = useStore((s) => s.selectPath);
  const setScanInProgress = useStore((s) => s.setScanInProgress);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanTotalBytes, setScanTotalBytes] = useState<number | null>(null);
  const [diag, setDiag] = useState<ScanDiag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Holds the latest scan-stats event so we can merge it into ScanDiag once
  // api.scan() returns. Tauri emits the event right before the command resolves.
  const lastBackendStats = useRef<ScanStatsEvent | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<{ files_seen: number; bytes_seen: number; current_path: string }>(
      'scan-progress',
      (e) => setScanProgress({
        files: e.payload.files_seen,
        bytes: e.payload.bytes_seen,
        path: e.payload.current_path,
      }),
    );
    return () => { unlisten.then((u) => u()); };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<ScanStatsEvent>('scan-stats', (e) => {
      lastBackendStats.current = e.payload;
    });
    return () => { unlisten.then((u) => u()); };
  }, []);

  const start = useCallback(async () => {
    if (!pickedPath) return;
    setErr(null);
    setScanning(true);
    setScanProgress(null);
    setScanTotalBytes(null);
    setDiag(null);
    lastBackendStats.current = null;

    if (isTauri) {
      if (isDriveRoot(pickedPath)) {
        // Drive root: ask the OS for used bytes — instant, exact.
        api.volumeInfo(pickedPath)
          .then((info) => { if (info) setScanTotalBytes(info.used_bytes); })
          .catch(() => {});
      } else {
        // Subfolder: run a fast size-only walk in parallel with the real scan.
        // The real scan is doing the same work either way; this just gives the
        // progress bar an exact denominator a bit ahead of completion.
        api.estimateSize(pickedPath)
          .then((bytes) => { if (bytes > 0) setScanTotalBytes(bytes); })
          .catch(() => {});
      }
    }

    const tTotal0 = performance.now();
    try {
      const tScan0 = performance.now();
      const node = await api.scan(pickedPath);
      const tScan1 = performance.now();

      const tSet0 = performance.now();
      setRoot(node);
      select(node.path);
      const tSet1 = performance.now();

      const totalMs = tSet1 - tTotal0;
      // Cast through the ref accessor: TS narrows `.current` to the last
      // assignment it sees in this flow (the `= null` reset earlier), missing
      // the listener's assignment from another effect.
      const backend = lastBackendStats.current as ScanStatsEvent | null;
      const ipcMs: number | null = backend !== null
        ? Math.max(0, (tScan1 - tScan0) - backend.cmd_total_ms)
        : null;
      const next: ScanDiag = {
        backend,
        ipcMs,
        scanCallMs: tScan1 - tScan0,
        setRootMs: tSet1 - tSet0,
        totalMs,
      };
      setDiag(next);
      // eslint-disable-next-line no-console
      console.log('[pinkbin.diag]', {
        backend,
        scanCallMs: next.scanCallMs.toFixed(1),
        ipcMs: ipcMs?.toFixed(1) ?? null,
        setRootMs: next.setRootMs.toFixed(1),
        totalMs: totalMs.toFixed(1),
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setScanning(false);
      setScanInProgress(false);
    }
  }, [pickedPath, setRoot, select, setScanInProgress]);

  // Mirror the local scanning flag into the store so non-hook consumers
  // (Studio) can react without prop-drilling.
  useEffect(() => {
    setScanInProgress(scanning);
  }, [scanning, setScanInProgress]);

  return { scanning, scanProgress, scanTotalBytes, diag, err, start };
}