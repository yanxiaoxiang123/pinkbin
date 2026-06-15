import { useCallback, useEffect, useMemo, useRef, useState, memo, type CSSProperties, type MouseEvent } from 'react';
import clsx from 'clsx';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { ChevronRight, ChevronDown, FolderOpen, Copy } from 'lucide-react';
import type { Node } from '../types';
import { formatBytes, formatCount } from '../format';
import { api } from '../api';
import { ContextMenu, type ContextMenuState } from './ContextMenu';

type Props = {
  root: Node;
  selectedPath: string | null;
  onSelect: (p: string) => void;
};

// Check if `el` or any ancestor has `[data-accept-drop]`.
function isAcceptDropTarget(el: EventTarget | null): boolean {
  let node = (el as HTMLElement | null)?.closest('[data-accept-drop]');
  return node !== null;
}

const ROW_HEIGHT = 22;
const CHILD_LIMIT = 500;

type NodeRow = {
  kind: 'node';
  node: Node;
  parentSize: number;
  depth: number;
};
type TruncatedRow = {
  kind: 'truncated';
  parent: Node;
  hidden: number;
  depth: number;
};
type VisibleRow = NodeRow | TruncatedRow;

export function TreeView({ root, selectedPath, onSelect }: Props) {
  const [ctx, setCtx] = useState<ContextMenuState | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set([root.path]));
  const { ref: bodyRef, size } = useElementSize();

  // Reset expanded paths whenever a new scan lands — old paths in the set
  // simply miss on the new tree (no-op) but the explicit reset keeps
  // memory from carrying paths that may not exist anymore.
  useEffect(() => {
    setOpen(new Set([root.path]));
  }, [root.path]);

  // Global drop-target guard: when dragging a TreeView row over an element
  // that does NOT have `[data-accept-drop]` (e.g. Studio, TreeView itself),
  // add `drop-target-forbidden` to body so users see a "not-allowed" cursor
  // instead of thinking the drop will work.
  useEffect(() => {
    const onDragEnterOver = (e: DragEvent) => {
      document.body.classList.toggle('drop-target-forbidden', !isAcceptDropTarget(e.target));
    };
    const onDragEnd = () => {
      document.body.classList.remove('drop-target-forbidden');
    };
    // Only activate guard when a TreeView row starts being dragged.
    const onDragStart = (e: DragEvent) => {
      const tree = (e.target as HTMLElement)?.closest('.treeview');
      if (!tree) return; // not from TreeView
      document.addEventListener('dragenter', onDragEnterOver);
      document.addEventListener('dragover', onDragEnterOver);
      document.addEventListener('dragleave', onDragEnd);  // reset on leave
      document.addEventListener('drop', onDragEnd);
      document.addEventListener('dragend', onDragEnd, { once: true });
    };
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragenter', onDragEnterOver);
      document.removeEventListener('dragover', onDragEnterOver);
      document.removeEventListener('dragleave', onDragEnd);
      document.removeEventListener('drop', onDragEnd);
      document.removeEventListener('dragend', onDragEnd);
      document.body.classList.remove('drop-target-forbidden');
    };
  }, []);

  const flatRows = useMemo<VisibleRow[]>(() => {
    const out: VisibleRow[] = [];
    const visit = (n: Node, depth: number, parentSize: number) => {
      if (depth > 0) {
        out.push({ kind: 'node', node: n, parentSize, depth });
      }
      if (n.is_dir && open.has(n.path) && n.children.length > 0) {
        const kids = n.children;
        const showCount = Math.min(kids.length, CHILD_LIMIT);
        for (let i = 0; i < showCount; i++) {
          visit(kids[i], depth + 1, n.size || 1);
        }
        if (kids.length > CHILD_LIMIT) {
          out.push({
            kind: 'truncated',
            parent: n,
            hidden: kids.length - CHILD_LIMIT,
            depth: depth + 1,
          });
        }
      }
    };
    visit(root, 0, root.size || 1);
    return out;
  }, [root, open]);

  const toggle = useCallback((path: string) => {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openCtx = useCallback((e: MouseEvent, node: Node) => {
    e.preventDefault();
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '在文件管理器中打开',
          icon: <FolderOpen size={12} />,
          onClick: () => { api.revealInExplorer(node.path).catch(() => { /* path may have been deleted */ }); },
        },
        {
          label: '复制路径',
          icon: <Copy size={12} />,
          onClick: () => { navigator.clipboard?.writeText(node.path).catch(() => { /* ignore */ }); },
        },
      ],
    });
  }, []);

  const renderRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const row = flatRows[index];
      if (row.kind === 'truncated') {
        return <TruncatedRowView row={row} style={style} />;
      }
      return (
        <NodeRowView
          row={row}
          style={style}
          isSelected={row.node.path === selectedPath}
          isOpen={open.has(row.node.path)}
          onSelect={onSelect}
          onToggle={toggle}
          onCtx={openCtx}
        />
      );
    },
    [flatRows, selectedPath, open, onSelect, toggle, openCtx],
  );

  return (
    <div className="treeview">
      <div className="tree-headrow">
        <div className="col-name">文件夹</div>
        <div className="col-pct">父级 %</div>
        <div className="col-size">大小</div>
        <div className="col-count">项目</div>
      </div>
      <div className="tree-body" ref={bodyRef}>
        {size.height > 0 && size.width > 0 && (
          <FixedSizeList
            height={size.height}
            width={size.width}
            itemCount={flatRows.length}
            itemSize={ROW_HEIGHT}
            overscanCount={8}
          >
            {renderRow}
          </FixedSizeList>
        )}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </div>
  );
}

type NodeRowViewProps = {
  row: NodeRow;
  style: CSSProperties;
  isSelected: boolean;
  isOpen: boolean;
  onSelect: (p: string) => void;
  onToggle: (p: string) => void;
  onCtx: (e: MouseEvent, node: Node) => void;
};

const NodeRowView = memo(function NodeRowView({
  row, style, isSelected, isOpen, onSelect, onToggle, onCtx,
}: NodeRowViewProps) {
  const { node, parentSize, depth } = row;
  const hasKids = (node.children?.length ?? 0) > 0;
  const pct = parentSize > 0 ? (node.size / parentSize) * 100 : 0;
  return (
    <div
      className={clsx('tree-row', isSelected && 'selected', !node.is_dir && 'is-file')}
      style={style}
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => onCtx(e, node)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-pinkbin-path', node.path);
        e.dataTransfer.setData('application/x-pinkbin-name', node.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={node.path + '  ·  右键查看选项'}
    >
      <div className="col-name" style={{ paddingLeft: 4 + depth * 14 }}>
        <span
          className="caret"
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.path); }}
        >
          {hasKids
            ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
            : <span className="caret-stub" />}
        </span>
        <span className="glyph">
          {node.is_dir ? <FolderGlyph open={isOpen} /> : <FileGlyph ext={extOf(node.name)} />}
        </span>
        <span className="name">{node.name || node.path}</span>
        {node.scaffold_id && <span className="badge">{node.scaffold_id}</span>}
      </div>
      <div className="col-pct">
        <span className="pct-bar"><span style={{ width: `${Math.min(100, pct)}%` }} /></span>
        <span className="pct-num">{pct.toFixed(1)}%</span>
      </div>
      <div className="col-size">{formatBytes(node.size)}</div>
      <div className="col-count">{formatCount(node.file_count)}</div>
    </div>
  );
});

type TruncatedRowViewProps = {
  row: TruncatedRow;
  style: CSSProperties;
};

const TruncatedRowView = memo(function TruncatedRowView({ row, style }: TruncatedRowViewProps) {
  return (
    <div className="tree-row is-truncated" style={style}>
      <div className="col-name" style={{ paddingLeft: 4 + row.depth * 14 }}>
        <span className="caret-stub" />
        <span className="name">… 还有 {formatCount(row.hidden)} 个未显示（Pinkbin 限制每层 {CHILD_LIMIT} 项）</span>
      </div>
    </div>
  );
});

function FolderGlyph({ open }: { open: boolean }) {
  // Windows-style yellow folder (closed/open variants).
  if (open) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V6.8 H3.6 L1.5 12.5 Z" fill="#f5c75e" stroke="#9c7c2a" strokeWidth="0.7" />
        <path d="M3.6 6.8 H15.2 L13.2 12.5 H1.5 Z" fill="#ffd97a" stroke="#9c7c2a" strokeWidth="0.7" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 4.5 A1 1 0 0 1 2.5 3.5 H6 L7.5 5 H13.5 A1 1 0 0 1 14.5 6 V12.5 A1 1 0 0 1 13.5 13.5 H2.5 A1 1 0 0 1 1.5 12.5 Z" fill="#f5c75e" stroke="#9c7c2a" strokeWidth="0.8" strokeLinejoin="round" />
      <path d="M1.5 6 H14.5" stroke="#9c7c2a" strokeWidth="0.5" opacity="0.5" />
    </svg>
  );
}

function FileGlyph({ ext }: { ext: string }) {
  // Pick a tint by file family — keeps the tree visually grep-able like Explorer.
  const fill =
    /^(exe|msi|cmd|bat|com)$/i.test(ext) ? '#cfe6ff' :
    /^(dll|sys|drv|ocx)$/i.test(ext) ? '#dfd6f7' :
    /^(zip|rar|7z|tar|gz|xz)$/i.test(ext) ? '#ffd6c0' :
    /^(png|jpg|jpeg|gif|bmp|webp|svg|ico)$/i.test(ext) ? '#ffd0e6' :
    /^(mp3|wav|flac|m4a|ogg)$/i.test(ext) ? '#d0f0d8' :
    /^(mp4|mov|mkv|avi|webm)$/i.test(ext) ? '#c8eaef' :
    /^(txt|md|log)$/i.test(ext) ? '#fff1bd' :
    /^(json|toml|yaml|yml|xml|ini|conf)$/i.test(ext) ? '#e6f0ff' :
    /^(pdf)$/i.test(ext) ? '#ffc5c5' :
    '#ffffff';
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 2 H10 L13 5 V13.5 A0.5 0.5 0 0 1 12.5 14 H3.5 A0.5 0.5 0 0 1 3 13.5 V2.5 A0.5 0.5 0 0 1 3.5 2 Z"
        fill={fill} stroke="#5b4d57" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M10 2 V5 H13" fill="none" stroke="#5b4d57" strokeWidth="0.7" strokeLinejoin="round" />
    </svg>
  );
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const setFromEntry = (entry: ResizeObserverEntry) => {
      const r = entry.contentRect;
      setSize({ width: r.width, height: r.height });
    };
    setFromEntry({ contentRect: el.getBoundingClientRect() } as ResizeObserverEntry);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setFromEntry(entry);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}