import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, ChevronDown, Sparkles, MessageSquare, Trash2, FolderOpen, Copy, ExternalLink, Gamepad2, ArchiveX, Undo2 } from 'lucide-react';
import { useStore } from '../store';
import { formatBytes } from '../format';
import { api, errorMessage } from '../api';
import type { Node, Scaffold } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { getBool } from '../persist';
import { t } from '../messages';
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
function fallbackByNameContains(root: Node | null, sc: Scaffold): Node | null {
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

  const [hidden] = useState(() => getBool('hideStudio', false));
  const scanInProgress = useStore((s) => s.scanInProgress);

  const [pruneMsg, setPruneMsg] = useState<string | null>(null);
  const [pruneLoading, setPruneLoading] = useState(false);
  const handlePruneQuarantine = useCallback(async () => {
    setPruneLoading(true);
    setPruneMsg(null);
    try {
      const r = await api.pruneQuarantine(7);
      setPruneMsg(
        r.removed_count > 0
          ? t('studio.pruneSuccess', { count: r.removed_count, size: formatBytes(r.removed_bytes) })
          : t('studio.pruneEmpty')
      );
    } catch (e) {
      setPruneMsg(t('studio.pruneFail', { error: errorMessage(e) }));
    } finally {
      setPruneLoading(false);
    }
  }, []);

  const [lastUndo, setLastUndo] = useState<import('../types').UndoEntry | null>(null);
  useEffect(() => {
    api.lastUndoEntry().then(setLastUndo).catch(() => {});
  }, []);
  const handleUndo = useCallback(async () => {
    if (!lastUndo) return;
    if (lastUndo.action === 'recycle') {
      try { await api.openRecycleBin(); } catch { /* noop */ }
    }
    // quarantine / delete: nothing actionable from the OS side; the button
    // just shows the reason so the user knows what happened.
  }, [lastUndo]);

  // Pre-compute scaffold matches in a single tree walk instead of 28 DFS.
  const matchesByScaffold = useMemo(() => {
    const map = new Map<string, Node[]>();
    if (!root) return map;
    const dfs = (n: Node) => {
      if (n.scaffold_id) {
        let arr = map.get(n.scaffold_id);
        if (!arr) { arr = []; map.set(n.scaffold_id, arr); }
        arr.push(n);
        return; // don't recurse into already-tagged subtrees
      }
      for (const c of n.children ?? []) dfs(c);
    };
    dfs(root);
    return map;
  }, [root]);

  const allCards: CardData[] = useMemo(() => {
    if (hidden) return [];
    const items: CardData[] = scaffolds.map((sc) => {
      let matches = matchesByScaffold.get(sc.id) ?? [];
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
  }, [scaffolds, matchesByScaffold, root, hidden]);

  if (hidden) {
    return (
      <div className="studio">
        <div className="studio-head">
          <span>Studio</span>
          <span className="muted small">{t('studio.hidden')}</span>
        </div>
      </div>
    );
  }

  const featured = allCards.filter((c) => FEATURED_IDS.includes(c.scaffold.id));
  const others = allCards.filter((c) => !FEATURED_IDS.includes(c.scaffold.id));

  return (
    <div className={clsx('studio', scanInProgress && 'stale')}>
      <div className="studio-head">
        <span>Studio</span>
        <div className="studio-head-actions">
          <span className="muted small">{t('studio.scripts', { n: allCards.length })}</span>
          {lastUndo && (
            <button
              className="ghost studio-undo-btn"
              onClick={handleUndo}
              title={
                lastUndo.action === 'recycle'
                  ? t('studio.undo.recycle', { reason: lastUndo.reason })
                  : lastUndo.action === 'quarantine'
                    ? t('studio.undo.quarantine', { reason: lastUndo.reason })
                    : t('studio.undo.delete', { reason: lastUndo.reason })
              }
            >
              <Undo2 size={12} />
              {t('studio.undo', { label: lastUndo.reason.length > 20 ? lastUndo.reason.slice(0, 20) + '…' : lastUndo.reason })}
            </button>
          )}
          <button
            className="ghost studio-prune-btn"
            onClick={handlePruneQuarantine}
            disabled={pruneLoading}
            title={t('studio.pruneTitle')}
          >
            <ArchiveX size={12} />
            {pruneLoading ? t('studio.pruneRunning') : t('studio.pruneIdle')}
          </button>
        </div>
      </div>

      {pruneMsg && (
        <div className="studio-prune-msg muted small" aria-live="polite">{pruneMsg}</div>
      )}

      {allCards.length === 0 && !scanInProgress && (
        <div className="studio-empty muted">{t('studio.loading')}</div>
      )}

      <div className="studio-section-label">{t('studio.featured')}</div>
      <div className="studio-grid">
        <ErrorBoundary fallbackLabel={t('studio.steamCardFail')}>
          <ToolCard
            icon={<Gamepad2 size={14} />}
            name={t('studio.steam.name')}
            blurb={t('studio.steam.blurb')}
            onClick={() => setOpenTool('steam-inspector')}
          />
        </ErrorBoundary>
        {featured.map((c) => (
          <ErrorBoundary key={c.scaffold.id} fallbackLabel={t('studio.cardRenderFail', { name: c.scaffold.name })}>
            <Card card={c} onAsk={() => requestStudio(c.scaffold.id)} />
          </ErrorBoundary>
        ))}
      </div>

      {others.length > 0 && (
        <>
          <div className="studio-section-label">{t('studio.more')}</div>
          <div className="studio-grid">
            {others.map((c) => (
              <ErrorBoundary key={c.scaffold.id} fallbackLabel={t('studio.cardRenderFail', { name: c.scaffold.name })}>
                <Card card={c} onAsk={() => requestStudio(c.scaffold.id)} />
              </ErrorBoundary>
            ))}
          </div>
        </>
      )}

      {openTool === 'steam-inspector' && (
        <Suspense fallback={<div className="modal-bg">{t('studio.loadingModal')}</div>}>
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

function Card({ card, onAsk }: { card: CardData; onAsk: () => void }) {
  const sc = card.scaffold;
  const matches = card.matches;
  const detected = matches.length > 0;
  const expanded = useStore((s) => s.studioExpanded.includes(sc.id));
  const toggleExpanded = useStore((s) => s.toggleStudioExpanded);
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
          label: t('studio.ctxOpen'),
          icon: <FolderOpen size={12} />,
          onClick: () => { api.revealInExplorer(p).catch(() => { /* path may have been deleted */ }); },
        },
        {
          label: t('studio.ctxCopy'),
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
        onClick={() => toggleExpanded(sc.id)}
        title={sc.disclaimer}
      >
        <Caret size={14} className="studio-caret" />
        <div className="studio-card-icon">{ICONS[sc.id] ?? '🧹'}</div>
        <div className="studio-card-body">
          <div className="studio-card-name">{sc.name}</div>
          <div className="studio-card-meta">
            {detected
              ? <><Sparkles size={10} /> {formatBytes(card.totalSize)}{matches.length > 1 && <> · {t('studio.positions', { n: matches.length })}</>}</>
              : <>{t('studio.notDetected')}</>}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="studio-card-expanded">
          {detected ? (
            <>
              <div className="studio-detail-row">
                <span className="studio-detail-label">{t('studio.path')}</span>
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
                      title={t('studio.dragHint')}
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
                <span className="studio-detail-label">{t('studio.size')}</span>
                <span className="mono-num">
                  {t('studio.sizeDetail', { size: formatBytes(card.totalSize), files: card.totalFiles.toLocaleString() })}
                  {matches.length > 1 && <span className="muted small studio-detail-suffix">{t('studio.sizeCombined', { n: matches.length })}</span>}
                </span>
              </div>

              {topChildrenAll.length > 0 && (
                <>
                  <div className="studio-detail-label studio-top-children-head">
                    <span>{t('studio.topChildren')}</span>
                    {topChildrenAll.length > 3 && (
                      <button
                        type="button"
                        className="ghost studio-toggle-btn"
                        onClick={() => setShowAllChildren((v) => !v)}
                      >
                        {showAllChildren
                          ? t('studio.collapse')
                          : t('studio.expandAll', { n: hiddenChildrenCount })}
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
                        title={c.path + '  ·  ' + t('studio.ctxHint')}
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
                  title={card.totalSize === 0 ? t('studio.emptyDirTitle') : undefined}
                >
                  <Trash2 size={12} /> {card.totalSize === 0 ? t('studio.emptyDir') : t('studio.configureClean')}
                </button>
                <button className="secondary studio-ask-btn" onClick={onAsk}>
                  <MessageSquare size={12} /> {t('studio.askAI')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="studio-detail-label">{t('studio.defaultPaths')}</div>
              <ul className="studio-children muted small">
                {sc.detect.slice(0, 4).map((p) => <li key={p}>{p}</li>)}
              </ul>
              <div className="studio-detail-label">{t('studio.description')}</div>
              <p className="muted small studio-disclaimer-text">{sc.disclaimer}</p>
              <button className="primary studio-ask-btn studio-top-cta" onClick={onAsk}>
                <MessageSquare size={12} /> {t('studio.askAIHint')}
              </button>
            </>
          )}
        </div>
      )}

      {showCleanup && detected && (
        <Suspense fallback={<div className="modal-bg">{t('studio.loadingModal')}</div>}>
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
