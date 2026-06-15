import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { uid, buildOverviewSummary } from '../chatUtils';
import { formatBytes } from '../format';
import { overviewChat } from '../advisorClient';
import type { Node } from '../types';

/**
 * Auto-fires a conversational overview when a new scan root appears.
 * Returns `runOverview` for manual re-triggering.
 */
export function useOverview() {
  const root = useStore((s) => s.root);
  const pushTurn = useStore((s) => s.pushChatTurn);
  const patchTurn = useStore((s) => s.patchChatTurn);
  const setBusy = useStore((s) => s.setChatBusy);
  const beginChatRequest = useStore((s) => s.beginChatRequest);
  const endChatRequest = useStore((s) => s.endChatRequest);

  const overviewFiredFor = useRef<string | null>(null);

  const runOverview = useCallback(async (r: Node) => {
    setBusy(true);
    const turnId = uid();
    pushTurn({
      id: turnId,
      role: 'assistant',
      text: `已扫完 ${r.path} · ${formatBytes(r.size)} · ${r.file_count.toLocaleString()} 个文件。AI 正在生成整体解析…`,
      pending: true,
    });
    let accumulated = '';
    const onChunk = (chunk: string) => {
      accumulated += chunk;
      patchTurn(turnId, { text: accumulated });
    };
    const signal = beginChatRequest();
    try {
      const summary = buildOverviewSummary(r);
      await overviewChat(summary, { onChunk, signal });
      patchTurn(turnId, { pending: false });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        patchTurn(turnId, { text: accumulated, pending: false });
      } else {
        patchTurn(turnId, {
          text: `（AI 总览失败：${String(e)}）\n你可以从左边把任意文件夹/文件拖进来问。`,
          pending: false,
        });
      }
    } finally {
      setBusy(false);
      endChatRequest(signal);
    }
  }, [pushTurn, patchTurn, setBusy, beginChatRequest, endChatRequest]);

  useEffect(() => {
    if (!root) return;
    if (overviewFiredFor.current === root.path) return;
    overviewFiredFor.current = root.path;
    runOverview(root);
  }, [root?.path, runOverview]);

  return { runOverview };
}