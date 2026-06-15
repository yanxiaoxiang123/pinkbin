import { lazy, Suspense, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, ChevronDown, Sparkles, MessageSquare, Trash2, FolderOpen, Copy, ExternalLink, Gamepad2 } from 'lucide-react';
import { useStore } from '../store';
import { formatBytes } from '../format';
import { api } from '../api';
import type { Node, Scaffold } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { getBool } from '../persist';
import { collectScaffoldMatches } from '../tree';
import './Studio.css';

const CleanupModal = lazy(() => import('./CleanupModal').then((m) => ({ default: m.CleanupModal })));
const SteamInspectorModal = lazy(() => import('./SteamInspectorModal').then((m) => ({ default: m.SteamInspectorModal })));

const FEATURED_IDS = [
  'wechat-pc',
  'conda',
];

const ICONS: Record<string, string> = {
  'wechat-pc': '💬',
  'conda':     '🐍',
};

/// Collect every top-level node tagged with `scaffoldId`. We deliberately
/// don't recurse into a subtree that already matched — a single scaffold
/// rarely re-tags itself deeper, and skipping the descent keeps walks under
/// each match disjoint so scope_sizes aggregation can't double-count the
/// same files.
function findAllMatchesByScaffold(root: Node | null, scaffoldId: string): Node[] {
  if (!root) return [];
  const out: Node[] = [];
  const dfs = (n: Node) => {
    if (n.scaffold_id === scaffoldId) {
      out.push(n);
      return;
    }
    for (const c of n.children ?? []) dfs(c);
  };
  dfs(root);
  return out;
}function fallbackByNameContains(root: Node | null, sc: Scaffold): Node | null {
  const fragments = (sc.match?.name_contains ?? []).map((s) => s.toLowerCase());
  if (fragments.length === 0 || !root) return null;
  const dfs = (n: Node | null): Node | null => {
    if (!n) return null;
    const lower = n.path.toLowerCase();
    if (fragments.some((f) => lower.includes(f))) return n;
    for (const c of n.children ?? []) {
      const f = dfs(c);
      if (f) return f;
    }
    return null;
  };
  return dfs(root);
}

interface CardData {
  scaffold: Scaffold;
  matches: Node[];
  totalSize: number;
  totalFiles: number;
}

export function Studio() {
  const root = useStore((s) => s.root);
  const scaffolds = useStore((s) => s.scaffolds);
  const requestStudio = useStore((s) => s.requestStudio);

  const [openTool, setOpenTool] = useState<null | 'steam-inspector'>(null);

  // expanded set persisted to localStorage via the store; survives restarts.
  const expandedArr = useStore((s) => s.studioExpanded);
  const expanded = useMemo(() => new Set(expandedArr), [expandedArr]);
  const toggleExpanded = useStore((s) => s.toggleStudioExpanded);

  const hidden = getBool('hideStudio', false);
  const scanInProgress = useStore((s) => s.scanInProgress);

  const allCards: CardData[] = useMemo(() => {
    if (hidden) return [];
    const items: CardData[] = scaffolds.map((sc) => {
      let matches = collectScaffoldMatches(root, sc.id);
      if (matches.length === 0) {
        const fb = fallbackByNameContains(root, sc);
        if (fb) matches = [fb];
      }
      matches.sort((a, b) => b.size - a.size);
      const totalSize = matches.reduce((s, m) => s + m.size, 0);
      const totalFiles = matches.reduce((s, m) => s + m.file_count, 0);
      return { scaffold: sc, matches, totalSize, totalFiles };
    });
    items.sort((a, b) => {
      const aDet = a.matches.length > 0;
      const bDet = b.matches.length > 0;
      if (aDet && !bDet) return -1;
      if (!aDet && bDet) return 1;
      if (aDet && bDet) return b.totalSize - a.totalSize;
      return a.scaffold.name.localeCompare(b.scaffold.name);
    });
    return items;
  }, [scaffolds, root, hidden]);

  if (hidden) {
    return (
      <div className="studio">
        <div className="studio-head">
          <span>Studio</span>
          <span className="muted small">已隐藏（pinkbin.hideStudio=1）</span>
        </div>
      </div>
    );
  }

  const featured = allCards.filter((c) => FEATURED_IDS.includes(c.scaffold.id));
  const others = allCards.filter((c) => !FEATURED_IDS.includes(c.scaffold.id));

  const toggle = (id: string) => toggleExpanded(id);

  return (
    <div className={clsx('studio', scanInProgress && 'stale')}>
      <div className="studio-head">
        <span>Studio</span>
        <span className="muted small">{allCards.length} 个脚本</span>
      </div>

      {allCards.length === 0 && !scanInProgress && (
        <div className="studio-empty muted">脚本加载中…</div>
      )}

      <div className="studio-section-label">推荐</div>
      <div className="studio-grid">
        <ErrorBoundary fallbackLabel="Steam Inspector 卡片渲染失败">
          <ToolCard
            icon={<Gamepad2 size={14} />}
            name="Steam Inspector"
            blurb="哪些游戏好久没玩 · 一键唤起 Steam 卸载"
            onClick={() => setOpenTool('steam-inspector')}
          />
        </ErrorBoundary>
        {featured.map((c) => (
          <ErrorBoundary key={c.scaffold.id} fallbackLabel={`${c.scaffold.name} 卡片渲染失败`}>
            <Card card={c} expanded={expanded.has(c.scaffold.id)} onToggle={() => toggle(c.scaffold.id)} onAsk={() => requestStudio(c.scaffold.id)} />
          </ErrorBoundary>
        ))}
      </div>

      {others.length > 0 && (
        <>
          <div className="studio-section-label">更多</div>
          <div className="studio-grid">
            {others.map((c) => (
              <ErrorBoundary key={c.scaffold.id} fallbackLabel={`${c.scaffold.name} 卡片渲染失败`}>
                <Card card={c} expanded={expanded.has(c.scaffold.id)} onToggle={() => toggle(c.scaffold.id)} onAsk={() => requestStudio(c.scaffold.id)} />
              </ErrorBoundary>
            ))}
          </div>
        </>
      )}

      {openTool === 'steam-inspector' && (
        <Suspense fallback={<div className="modal-bg">加载中…</div>}>
          <SteamInspectorModal onClose={() => setOpenTool(null)} />
        </Suspense>
      )}
    </div>
  );
}

/// Tool cards live in Studio alongside scaffold cards but behave differently:
/// no inline expansion, no "X 个位置" detection meta — just a card-shaped
/// entry point that opens a dedicated modal. Steam Inspector is the first
/// tool; future "always-on" panels (Epic / GOG inspectors, library reports)
/// can reuse this shape.
function ToolCard({
  icon,
  name,
  blurb,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <div className="studio-card-wrap risk-low tool-card-wrap">
      <button className="studio-card tool-card" onClick={onClick} title={blurb}>
        <ExternalLink size={12} className="studio-caret tool-card-arrow" />
        <div className="studio-card-icon tool-card-icon">{icon}</div>
        <div className="studio-card-body">
          <div className="studio-card-name">{name}</div>
          <div className="studio-card-meta">{blurb}</div>
        </div>
      </button>
    </div>
  );
}

function Card({ card, expanded, onToggle, onAsk }: { card: CardData; expanded: boolean; onToggle: () => void; onAsk: () => void }) {
  const sc = card.scaffold;
  const matches = card.matches;
  const detected = matches.length > 0;
  const Caret = expanded ? ChevronDown : ChevronRight;
  const addReclaimed = useStore((s) => s.addReclaimed);

  const [showCleanup, setShowCleanup] = useState(false);
  const [showAllChildren, setShowAllChildren] = useState(false);
  const [ctx, setCtx] = useState<ContextMenuState | null>(null);

  const openCtx = (e: React.MouseEvent, p: string) => {
    e.preventDefault();
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '在文件管理器中打开',
          icon: <FolderOpen size={12} />,
          onClick: () => { api.revealInExplorer(p).catch(() => { /* path may have been deleted */ }); },
        },
        {
          label: '复制路径',
          icon: <Copy size={12} />,
          onClick: () => { navigator.clipboard?.writeText(p).catch(() => { /* ignore */ }); },
        },
      ],
    });
  };

  const topChildrenAll = (() => {
    const all: Node[] = [];
    for (const m of matches) {
      for (const c of m.children ?? []) all.push(c);
    }
    all.sort((a, b) => b.size - a.size);
    return all.slice(0, 30);
  })();
  const topChildren = showAllChildren ? topChildrenAll : topChildrenAll.slice(0, 3);
  const hiddenChildrenCount = Math.max(0, topChildrenAll.length - topChildren.length);

  return (
    <div className={clsx('studio-card-wrap', `risk-${sc.risk}`, detected && 'detected')}>
      <button
        className="studio-card"
        onClick={onToggle}
        title={sc.disclaimer}
      >
        <Caret size={14} className="studio-caret" />
        <div className="studio-card-icon">{ICONS[sc.id] ?? '🧹'}</div>
        <div className="studio-card-body">
          <div className="studio-card-name">{sc.name}</div>
          <div className="studio-card-meta">
            {detected
              ? <><Sparkles size={10} /> {formatBytes(card.totalSize)}{matches.length > 1 && <> · {matches.length} 个位置</>}</>
              : <>未扫到 · 用脚本默认路径</>}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="studio-card-expanded">
          {detected ? (
            <>
              <div className="studio-detail-row">
                <span className="studio-detail-label">路径</span>
                <div className="studio-detail-paths">
                  {matches.map((m) => (
                    <span
                      key={m.path}
                      className="studio-detail-path"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-pinkbin-path', m.path);
                        e.dataTransfer.setData('application/x-pinkbin-name', m.name);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onContextMenu={(e) => openCtx(e, m.path)}
                      title="拖到中间问 AI · 右键查看选项"
                    >
                      {m.path}
                      {matches.length > 1 && (
                        <span className="muted small studio-detail-suffix">
                          {formatBytes(m.size)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <div className="studio-detail-row">
                <span className="studio-detail-label">大小</span>
                <span className="mono-num">
                  {formatBytes(card.totalSize)} · {card.totalFiles.toLocaleString()} 文件
                  {matches.length > 1 && <span className="muted small studio-detail-suffix">（{matches.length} 处合计）</span>}
                </span>
              </div>

              {topChildrenAll.length > 0 && (
                <>
                  <div className="studio-detail-label studio-top-children-head">
                    <span>占用最大的子项</span>
                    {topChildrenAll.length > 3 && (
                      <button
                        type="button"
                        className="ghost studio-toggle-btn"
                        onClick={() => setShowAllChildren((v) => !v)}
                      >
                        {showAllChildren
                          ? '收起'
                          : `展开全部（还有 ${hiddenChildrenCount}）`}
                      </button>
                    )}
                  </div>
                  <ul className="studio-children">
                    {topChildren.map((c) => (
                      <li
                        key={c.path}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-pinkbin-path', c.path);
                          e.dataTransfer.setData('application/x-pinkbin-name', c.name);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onContextMenu={(e) => openCtx(e, c.path)}
                        title={c.path + '  ·  右键查看选项'}
                      >
                        <span className="studio-child-name">{c.is_dir ? '📁' : '📄'} {c.name}</span>
                        <span className="mono-num">{formatBytes(c.size)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="studio-card-actions">
                <button
                  className="primary studio-cleanup-btn"
                  onClick={() => setShowCleanup(true)}
                  disabled={card.totalSize === 0}
                  title={card.totalSize === 0 ? '目录为空，无需清理' : undefined}
                >
                  <Trash2 size={12} /> {card.totalSize === 0 ? '空目录' : '配置清理…'}
                </button>
                <button className="secondary studio-ask-btn" onClick={onAsk}>
                  <MessageSquare size={12} /> 问 AI
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="studio-detail-label">脚本默认匹配路径</div>
              <ul className="studio-children muted small">
                {sc.detect.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
              </ul>
              <div className="studio-detail-label">说明</div>
              <p className="muted small studio-disclaimer-text">{sc.disclaimer}</p>
              <button className="primary studio-ask-btn studio-top-cta" onClick={onAsk}>
                <MessageSquare size={12} /> 问 AI：它一般在哪、能不能删
              </button>
            </>
          )}
        </div>
      )}

      {showCleanup && detected && (
        <Suspense fallback={<div className="modal-bg">加载中…</div>}>
          <CleanupModal
            scaffold={sc}
            matches={matches}
            onClose={() => setShowCleanup(false)}
            onCleaned={(bytes) => addReclaimed(bytes)}
          />
        </Suspense>
      )}
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </div>
  );
}
