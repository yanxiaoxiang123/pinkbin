import { lazy, Suspense, memo, useEffect, useRef, useState } from 'react';
import { Send, Trash2, ShieldCheck, ShieldAlert, ShieldX, X, MessageSquare, Sparkles, Folder, File, ImagePlus } from 'lucide-react';
import clsx from 'clsx';

const MarkdownRenderer = lazy(() =>
  Promise.all([import('react-markdown'), import('remark-gfm')]).then(
    ([md, gfm]) => ({ default: (props: { children: string }) => <md.default remarkPlugins={[gfm.default]}>{props.children}</md.default> })
  )
);
import { isTauri } from '../env';
import { useStore } from '../store';
import { formatBytes } from '../format';
import { useOverview } from '../hooks/useOverview';
import { useChat } from '../hooks/useChat';
import { useImageDrop } from '../hooks/useImageDrop';
import type { AdvisorResponse, Node } from '../types';
import { t } from '../messages';
import './ChatPanel.css';

export function ChatPanel() {
  const root = useStore((s) => s.root);
  const scaffolds = useStore((s) => s.scaffolds);
  const chatTurns = useStore((s) => s.chatTurns);
  const chatBusy = useStore((s) => s.chatBusy);
  const chatNode = useStore((s) => s.chatNode);
  const resetChat = useStore((s) => s.resetChat);
  const studioRequest = useStore((s) => s.studioRequest);
  const consumeStudio = useStore((s) => s.consumeStudio);
  const advisorReady = useStore((s) => s.advisorReady);

  // Auto-overview on scan complete
  useOverview();

  // Streaming chat actions
  const { askFollowUp, runStudioPrompt, recycleNode } = useChat();

  // Image paste / drop / file-picker
  const {
    pendingImages,
    setPendingImages,
    fileInputRef,
    addImageFile,
    onPaste,
    handleImageDrop,
  } = useImageDrop();

  // Local UI state
  const [input, setInput] = useState('');
  const [pendingDrops, setPendingDrops] = useState<{ path: string; name: string }[]>([]);
  const [dropping, setDropping] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isNearBottom = useRef(true);

  const node = chatNode;

  // Handle Studio card clicks — synthesize a prompt about the scaffold.
  useEffect(() => {
    if (!studioRequest) return;
    const sc = scaffolds.find((s) => s.id === studioRequest.scaffoldId);
    consumeStudio();
    if (!sc) return;
    runStudioPrompt(sc);
  }, [studioRequest, scaffolds, consumeStudio, runStudioPrompt]);

  // Track manual scroll-away from bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
      if (near !== isNearBottom.current) {
        isNearBottom.current = near;
        setShowScrollBtn(!near);
      }
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll only if user hasn't scrolled away from bottom.
  useEffect(() => {
    if (isNearBottom.current) {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatTurns.length, chatBusy]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    // If there are image files, handle them first.
    if (e.dataTransfer.files.length > 0) {
      const handled = await handleImageDrop(e.dataTransfer.files);
      if (handled) return;
    }
    // Otherwise check for pinkbin path transfer.
    const path = e.dataTransfer.getData('application/x-pinkbin-path');
    const name = e.dataTransfer.getData('application/x-pinkbin-name') || path.split(/[\\/]/).pop() || path;
    if (!path) return;
    setPendingDrops((prev) => (prev.find((p) => p.path === path) ? prev : [...prev, { path, name }]));
  };

  const empty = chatTurns.length === 0;

  return (
    <div
      className={clsx('chat', dropping && 'drop-target')}
      data-accept-drop="pinkbin-path"
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="chat-head">
        <Sparkles size={15} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-title">
            {root ? (root.name || root.path) : t('chat.title')}
          </div>
          <div className="chat-sub">
            {root
              ? `${root.path} · ${formatBytes(root.size)} · ${t('chat.files', { n: root.file_count.toLocaleString() })}`
              : t('chat.scanHint')}
          </div>
        </div>
        {chatTurns.length > 0 && (
          <button className="ghost icon" onClick={resetChat} title={t('chat.clearTitle')} aria-label={t('chat.clearLabel')}><X size={16} /></button>
        )}
      </div>

      <div className="chat-scroll" ref={scrollerRef}>
        {empty && !root && !advisorReady && (
          <div className="chat-hero">
            <MessageSquare size={32} />
            <h3>{t('chat.title')}</h3>
            <p dangerouslySetInnerHTML={{ __html: t('chat.noConfig', { strong: '<strong>', '/strong': '</strong>' }) }} />
          </div>
        )}
        {empty && !root && advisorReady && (
          <div className="chat-hero">
            <MessageSquare size={32} />
            <h3>{t('chat.title')}</h3>
            <p>{t('chat.hint')}</p>
            {!isTauri && <p className="muted">{t('chat.browserHint')}</p>}
          </div>
        )}
        {empty && root && advisorReady && (
          <div className="chat-hero">
            <Sparkles size={28} />
            <p>{t('chat.generating')}</p>
          </div>
        )}
        {chatTurns.map((t) => (
          <TurnBubble
            key={t.id}
            text={t.text}
            role={t.role}
            pending={t.pending ?? false}
            advice={t.advice ?? null}
            node={node}
            recycleNode={recycleNode}
          />
        ))}
        {chatBusy && <div className="chat-typing">{t('chat.typing')}</div>}
        {showScrollBtn && (
          <button
            className="chat-scroll-btn"
            onClick={() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' })}
            title={t('chat.scrollTitle')}
            aria-label={t('chat.scrollLabel')}
          >
            {t('chat.scrollBottom')}
          </button>
        )}
      </div>

      <div className="chat-input-wrap">
        {pendingDrops.length > 0 && (
          <div className="chat-pills">
            {pendingDrops.map((d) => (
              <span key={d.path} className="chat-pill" title={d.path}>
                {d.path.endsWith(d.name) && d.path !== d.name ? <Folder size={11} /> : <File size={11} />}
                {d.name}
                <button onClick={() => setPendingDrops((prev) => prev.filter((p) => p.path !== d.path))} aria-label={t('chat.removeLabel', { name: d.name })}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="chat-image-pills">
            {pendingImages.map((img) => (
              <span key={img.id} className="chat-image-pill" title={img.name}>
                <img src={img.dataUrl} alt={img.name} />
                <button
                  type="button"
                  onClick={() => setPendingImages((prev) => prev.filter((p) => p.id !== img.id))}
                  aria-label={t('chat.removeImageLabel', { name: img.name })}
                ><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            for (const f of files) await addImageFile(f);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <div className="chat-input">
          <button
            type="button"
            className="ghost icon chat-attach"
            onClick={() => fileInputRef.current?.click()}
            title={t('chat.attachTitle')}
            aria-label={t('chat.attachLabel')}
            disabled={chatBusy}
          >
            <ImagePlus size={15} />
          </button>
          <textarea
            rows={2}
            placeholder={root ? t('chat.placeholder.scan') : advisorReady ? t('chat.placeholder.ready') : t('chat.placeholder.config')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askFollowUp(input, pendingDrops, pendingImages);
              }
            }}
            disabled={!root && pendingImages.length === 0}
          />
          <button
            className="primary"
            onClick={() => askFollowUp(input, pendingDrops, pendingImages)}
            title={advisorReady ? undefined : t('chat.dropHint')}
            disabled={
              (!input.trim() && pendingDrops.length === 0 && pendingImages.length === 0) ||
              chatBusy ||
              (!root && pendingImages.length === 0) ||
              !advisorReady
            }
          >
            <Send size={14} /> {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Memoised per-turn bubble. Props are flat so default shallow compare skips
// re-render when only an unrelated turn's text changes during streaming.
const TurnBubble = memo(function TurnBubble({
  text,
  role,
  pending,
  advice,
  node,
  recycleNode,
}: {
  text: string;
  role: string;
  pending?: boolean;
  advice?: AdvisorResponse | null;
  node: Node | null;
  recycleNode: (target: Node, reason: string) => Promise<void>;
}) {
  return (
    <div className={clsx('chat-turn', role, pending && 'pending')}>
      {role === 'assistant' && advice && <AdviceCard advice={advice} />}
      <div className="chat-bubble">
        {role === 'assistant'
          ? <Suspense fallback={text}><MarkdownRenderer>{text}</MarkdownRenderer></Suspense>
          : text}
      </div>
      {role === 'assistant' && advice?.action === 'recycle' && !advice?.needs_inspection && !advice?.is_fallback && node && (
        <div className="chat-actions">
          <button className="primary" onClick={() => recycleNode(node, advice?.reasoning ?? 'AI suggested')}>
            <Trash2 size={13} /> {t('chat.recycle', { size: formatBytes(node.size) })}
          </button>
        </div>
      )}
    </div>
  );
});

function AdviceCard({ advice }: { advice: AdvisorResponse }) {
  const requestStudio = useStore((s) => s.requestStudio);
  // Fallback path: a canned / synthesized response from `mocks.advise`.
  // For an app that recommends whether to delete user files we cannot
  // let a fallback verdict drive an action — show a prominent warning
  // and skip the colored "risk: low/medium/high" framing entirely.
  if (advice.is_fallback) {
    return (
      <div className="advice-pill advice-fallback" role="alert" aria-live="polite">
        <ShieldX size={14} style={{ color: 'var(--risk-high)' }} />
        <strong>{t('chat.fallback')}</strong>
        <span className="muted">{advice.what}</span>
      </div>
    );
  }
  const Icon = advice.risk === 'low' ? ShieldCheck : advice.risk === 'medium' ? ShieldAlert : ShieldX;
  const color = advice.risk === 'low' ? 'var(--risk-low)' : advice.risk === 'medium' ? 'var(--risk-medium)' : 'var(--risk-high)';
  return (
    <div className="advice-pill" style={{ borderColor: color }}>
      <Icon size={14} style={{ color }} />
      <strong>{advice.category}</strong>
      <span className="badge">{advice.action}</span>
      <span className="muted">{t('chat.risk', { risk: advice.risk })}</span>
      {advice.needs_inspection && <span className="badge">{t('chat.needsInspect')}</span>}
      {advice.suggested_scaffold && (
        <button className="ghost advice-scaffold-link" onClick={() => requestStudio(advice.suggested_scaffold!)} title="在 Studio 中查看">
          {advice.suggested_scaffold}
        </button>
      )}
    </div>
  );
}