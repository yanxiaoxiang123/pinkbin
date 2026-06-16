import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Folder, ScanLine, Settings as SettingsIcon, StopCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { api } from './api';
import { isTauri } from './env';
import { useStore } from './store';
import { TreeView } from './components/TreeView';
import { ChatPanel } from './components/ChatPanel';
import { Studio } from './components/Studio';
import { Settings } from './components/Settings';
import { Splitter } from './components/Splitter';
import { Logo } from './components/Logo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DiagnosticsBar } from './components/DiagnosticsBar';
import { ToastContainer } from './components/Toast';
import { formatBytes } from './format';
import { loadSettings, isConfiguredAsync, ADVISOR_KEY_ACCOUNT } from './advisorClient';
import { ensureMigrated, getNumber, getJson, setJson, setNumber } from './persist';
import { useScan } from './hooks/useScan';

const DEFAULT_LEFT = 620;
const DEFAULT_RIGHT = 320;
const MIN_LEFT = 320;
const MIN_RIGHT = 220;
const MIN_CENTER = 360;

export default function App() {
  useEffect(() => { ensureMigrated(); }, []);

  const root = useStore((s) => s.root);
  const setScaffolds = useStore((s) => s.setScaffolds);
  const scaffolds = useStore((s) => s.scaffolds);
  const selectedPath = useStore((s) => s.selectedPath);
  const select = useStore((s) => s.selectPath);

  const [pickedPath, setPickedPath] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [advisorTag, setAdvisorTag] = useState<{ provider: string } | null>(null);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const v = getNumber('leftWidth', DEFAULT_LEFT);
    return v > MIN_LEFT ? v : DEFAULT_LEFT;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const v = getNumber('rightWidth', DEFAULT_RIGHT);
    return v > MIN_RIGHT ? v : DEFAULT_RIGHT;
  });

  const { scanning, scanProgress, scanTotalBytes, diag, err, start: scan, cancel } = useScan(pickedPath);
  const scanStartRef = useRef(0);
  const [scanEta, setScanEta] = useState('');

  // Compute scan speed and ETA from progress ticks.
  useEffect(() => {
    if (scanning && scanProgress) {
      if (scanStartRef.current === 0) scanStartRef.current = Date.now();
      const elapsed = (Date.now() - scanStartRef.current) / 1000;
      if (elapsed > 1 && scanProgress.bytes > 0) {
        const bps = scanProgress.bytes / elapsed;
        let text = `${formatBytes(bps)}/s`;
        if (scanTotalBytes && bps > 0) {
          const remaining = (scanTotalBytes - scanProgress.bytes) / bps;
          if (remaining > 0) {
            text += remaining > 60
              ? ` · 剩余 ${Math.ceil(remaining / 60)} 分`
              : ` · 剩余 ${Math.ceil(remaining)}s`;
          }
        }
        setScanEta(text);
      }
    } else {
      scanStartRef.current = 0;
      setScanEta('');
    }
  }, [scanning, scanProgress, scanTotalBytes]);

  useEffect(() => { api.listScaffolds().then(setScaffolds).catch(() => {}); }, [setScaffolds]);

  // One-shot migration: if the user upgraded from a version that stored
  // the key in localStorage, lift it into the OS credential manager and
  // drop the plaintext copy. The migrated value never enters the
  // webview's persistent state again.
  useEffect(() => {
    (async () => {
      try {
        const raw = getJson<{ apiKey?: string } & Record<string, unknown>>('advisor', null as never);
        if (raw && typeof raw.apiKey === 'string' && raw.apiKey) {
          const { apiKey, ...rest } = raw;
          await api.storeSecret(ADVISOR_KEY_ACCOUNT, apiKey);
          // Verify the key landed in the keyring before stripping localStorage.
          // A silent failure in storeSecret would otherwise lose the key.
          const stored = await api.loadSecret(ADVISOR_KEY_ACCOUNT);
          if (stored === apiKey) {
            setJson('advisor', rest);
          }
        }
      } catch { /* migration is best-effort; key stays in localStorage */ }
    })();
  }, []);

  const refreshAdvisorTag = async () => {
    const s = loadSettings();
    if (!s) { setAdvisorTag(null); return; }
    const ok = await isConfiguredAsync(s);
    setAdvisorTag(ok ? { provider: s.provider } : null);
  };
  useEffect(() => { refreshAdvisorTag(); }, []);

  const dragLeft = (dx: number) => {
    setLeftWidth((w) => {
      const winW = window.innerWidth;
      const maxLeft = Math.max(MIN_LEFT, winW - rightWidth - MIN_CENTER);
      return Math.max(MIN_LEFT, Math.min(maxLeft, w + dx));
    });
  };
  const dragRight = (dx: number) => {
    setRightWidth((w) => {
      const winW = window.innerWidth;
      const maxRight = Math.max(MIN_RIGHT, winW - leftWidth - MIN_CENTER);
      return Math.max(MIN_RIGHT, Math.min(maxRight, w - dx));
    });
  };

  const saveLeftWidth = () => { setNumber('leftWidth', leftWidth); };
  const saveRightWidth = () => { setNumber('rightWidth', rightWidth); };

  const pickDirectory = async () => {
    if (!isTauri) {
      const p = window.prompt('浏览器预览模式：输入一个路径（任意值都可以）', 'C:\\');
      if (p) setPickedPath(p);
      return;
    }
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === 'string') setPickedPath(picked);
  };

  return (
    <div className="app">
      <header>
        <span className="brand"><Logo size={22} /> Pinkbin</span>
        <button className="ghost" onClick={pickDirectory}>
          <Folder size={14} /> {pickedPath || '选择磁盘或文件夹'}
        </button>
        <button className="primary" onClick={scan} disabled={!pickedPath || scanning}>
          <ScanLine size={14} /> {scanning ? '扫描中…' : '扫描'}
        </button>
        {scanning && (
          <button className="ghost danger" onClick={cancel} title="取消扫描">
            <StopCircle size={14} /> 取消
          </button>
        )}
        <div className="grow" />
        <span className="muted small">
          {root ? `${formatBytes(root.size)} · ${root.file_count.toLocaleString()} 文件` : '未扫描'}
        </span>
        <button
          className={clsx('ghost icon settings-btn', advisorTag && 'bound')}
          onClick={() => setShowSettings(true)}
          title={advisorTag ? `已绑定 ${advisorTag.provider} · 点开管理` : 'AI 还没配置 · 点开设置'}
          aria-label="设置"
        >
          <SettingsIcon size={16} />
          {advisorTag && <span className="settings-dot" />}
        </button>
        {advisorTag && (
          <span className="provider-pill" title="当前 AI 提供商">
            {advisorTag.provider}
          </span>
        )}
      </header>

      {scanning && (
        <div className="scan-bar">
          <div
            className={clsx(
              'scan-bar-fill',
              scanTotalBytes && scanProgress ? 'determinate' : 'indeterminate',
            )}
            style={
              scanTotalBytes && scanProgress
                ? { width: `${Math.min(99, (scanProgress.bytes / scanTotalBytes) * 100)}%` }
                : undefined
            }
          />
          <div className="scan-bar-label">
            {scanProgress
              ? `${scanProgress.files.toLocaleString()} 个文件 · ${formatBytes(scanTotalBytes ? Math.min(scanProgress.bytes, scanTotalBytes) : scanProgress.bytes)}${scanTotalBytes ? ` / ${formatBytes(scanTotalBytes)}` : ''}${scanEta ? ` · ${scanEta}` : ''}`
              : '准备扫描…'}
          </div>
        </div>
      )}
      {diag && !scanning && <DiagnosticsBar diag={diag} />}
      {err && <div className="banner error">{err}</div>}

      <main style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr 4px ${rightWidth}px` }}>
        <aside className="left">
          {root ? <TreeView root={root} selectedPath={selectedPath} onSelect={select} /> : <EmptyLeft />}
        </aside>

        <Splitter onDrag={dragLeft} onDragEnd={saveLeftWidth} onDoubleClick={() => { setLeftWidth(DEFAULT_LEFT); setNumber('leftWidth', DEFAULT_LEFT); }} />

        <section className="center">
          <ChatPanel />
        </section>

        <Splitter onDrag={dragRight} onDragEnd={saveRightWidth} onDoubleClick={() => { setRightWidth(DEFAULT_RIGHT); setNumber('rightWidth', DEFAULT_RIGHT); }} />

        <aside className="right">
          <ErrorBoundary fallbackLabel="Studio 面板渲染失败">
            <Studio />
          </ErrorBoundary>
        </aside>
      </main>

      <footer>
        <span>Pinkbin v0.1.1 · {scaffolds.length} 个清理脚本</span>
        <span>{root?.path ?? '还没扫描'}</span>
      </footer>

      {showSettings && <Settings onClose={() => { setShowSettings(false); refreshAdvisorTag(); }} />}

      <ToastContainer />
    </div>
  );
}

function EmptyLeft() {
  return (
    <div className="empty">
      <div className="empty-title">还没扫描</div>
      <div className="empty-sub">在顶栏选一个文件夹，然后点「扫描」。<br />扫完之后，左侧会列出每个文件夹和文件。</div>
    </div>
  );
}