import { useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api';
import { uid, findNodeByPath } from '../chatUtils';
import { collectScaffoldMatches } from '../tree';
import { formatBytes } from '../format';
import { freeChat, redactChatContext } from '../advisorClient';
import { redactPath } from '../privacy';
import type { Node, Scaffold } from '../types';

/**
 * Streaming chat orchestration. Pure behavior — owns no UI state.
 * Callers pass input/pendingDrops/pendingImages as arguments.
 */
export function useChat() {
  const root = useStore((s) => s.root);
  const chatNode = useStore((s) => s.chatNode);
  const pushTurn = useStore((s) => s.pushChatTurn);
  const patchTurn = useStore((s) => s.patchChatTurn);
  const setBusy = useStore((s) => s.setChatBusy);
  const beginChatRequest = useStore((s) => s.beginChatRequest);
  const endChatRequest = useStore((s) => s.endChatRequest);
  const addReclaimed = useStore((s) => s.addReclaimed);

  const runStudioPrompt = useCallback(async (sc: Scaffold) => {
    const root = useStore.getState().root;
    const matches = collectScaffoldMatches(root, sc.id).sort((a, b) => b.size - a.size);
    const totalSize = matches.reduce((s, m) => s + m.size, 0);
    const totalFiles = matches.reduce((s, m) => s + m.file_count, 0);

    const userText = matches.length === 0
      ? `右侧的【${sc.name}】这次扫描里没扫到。它一般会在哪些路径下？里面通常存什么？`
      : matches.length === 1
        ? `右侧显示扫描里检测到了【${sc.name}】(${formatBytes(totalSize)}, \`${redactPath(matches[0]!.path)}\`)。这个文件夹里具体都是什么？哪些是可以删的？`
        : `右侧扫描里检测到了【${sc.name}】，分布在 ${matches.length} 个位置，合计 ${formatBytes(totalSize)} / ${totalFiles.toLocaleString()} 文件：\n${matches.map((m) => `- \`${redactPath(m.path)}\` (${formatBytes(m.size)})`).join('\n')}\n\n这些文件夹各自都是什么？哪些是可以删的？`;

    pushTurn({ id: uid(), role: 'user', text: userText });

    setBusy(true);
    const turnId = uid();
    pushTurn({ id: turnId, role: 'assistant', text: `正在分析 ${sc.name}…`, pending: true, scaffoldId: sc.id });
    let accumulated = '';
    const onChunk = (chunk: string) => {
      accumulated += chunk;
      patchTurn(turnId, { text: accumulated });
    };
    const signal = beginChatRequest();
    try {
      const nonEmpty = matches.filter((m) => m.size > 0 || (m.children?.length ?? 0) > 0);
      // Each match is a Node with full absolute paths (and sample_paths
      // that may contain adversarial filenames). Walk the structure and
      // apply both the path-tail collapse and the prompt-injection
      // redactor before stringifying for the AI.
      const sampledMatches = nonEmpty.map((m) =>
        redactChatContext({
          path: m.path,
          size: formatBytes(m.size),
          file_count: m.file_count,
          top_extensions: (m.top_extensions ?? []).slice(0, 5),
          top_children: (m.children ?? []).slice(0, 8).map((c) => ({
            name: c.name,
            size: formatBytes(c.size),
            is_dir: c.is_dir,
          })),
          sample_paths: m.sample_paths ?? [],
        }),
      );
      const ctx = {
        app: sc.name,
        scaffold_id: sc.id,
        risk: sc.risk,
        disclaimer: sc.disclaimer,
        // `sc.detect` is scaffold TOML globs (not user data), no PII to
        // scrub here.
        declared_paths: sc.detect,
        cleanable_scopes: sc.scopes.map((s) => ({ id: s.id, label: s.label, mode: s.mode, glob: s.glob })),
        scanned_matches: sampledMatches,
        scanned_total: matches.length > 0
          ? { location_count: matches.length, total_size: formatBytes(totalSize), total_files: totalFiles }
          : null,
      };
      await freeChat(
        `用户在 Studio 里点了【${sc.name}】这张卡片。下面是这个清理脚本的元数据，以及本次扫描中匹配到的所有位置（每个位置含 top children + 抽样路径）。请按位置分别说明里面是什么、哪些可以删、用什么方式删——不要只挑一个位置说：\n${JSON.stringify(ctx, null, 2)}`,
        userText,
        undefined,
        { onChunk, signal },
      );
      patchTurn(turnId, { pending: false });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        patchTurn(turnId, { text: accumulated, pending: false });
      } else {
        patchTurn(turnId, { text: `AI 调用失败：${e instanceof Error ? e.message : String(e)}`, pending: false });
      }
    } finally {
      setBusy(false);
      endChatRequest(signal);
    }
  }, [pushTurn, patchTurn, setBusy, beginChatRequest, endChatRequest]);

  const askFollowUp = useCallback(async (
    text: string,
    drops: { path: string; name: string }[],
    images: { id: string; name: string; dataUrl: string; mimeType: string }[],
  ) => {
    if (!text && drops.length === 0 && images.length === 0) return;
    if (!root && images.length === 0) return;

    const dropDesc = drops.length > 0
      ? `（关于：${drops.map((d) => redactPath(d.path)).join('、')}）`
      : '';
    const imgDesc = images.length > 0 ? `（带 ${images.length} 张图片）` : '';
    const userText = [text, dropDesc, imgDesc].filter(Boolean).join('\n');
    pushTurn({ id: uid(), role: 'user', text: userText });
    setBusy(true);
    const turnId = uid();
    pushTurn({ id: turnId, role: 'assistant', text: '思考中…', pending: true });

    let accumulated = '';
    const onChunk = (chunk: string) => {
      accumulated += chunk;
      patchTurn(turnId, { text: accumulated });
    };
    const signal = beginChatRequest();
    try {
      const targets = drops.length > 0 && root
        ? drops.map((d) => findNodeByPath(root, d.path)).filter(Boolean) as Node[]
        : chatNode ? [chatNode] : [];

      const ctx = targets.map((t) =>
        redactChatContext({
          path: t.path,
          name: t.name,
          size: formatBytes(t.size),
          is_dir: t.is_dir,
          file_count: t.file_count,
          top_extensions: (t.top_extensions ?? []).slice(0, 6),
          sample_children: (t.children ?? []).slice(0, 8).map((c) => ({
            name: c.name,
            size: formatBytes(c.size),
            is_dir: c.is_dir,
          })),
        }),
      );
      const contextLine = ctx.length > 0 ? `目标对象：${JSON.stringify(ctx, null, 2)}` : '';
      await freeChat(
        contextLine,
        text || (images.length > 0 ? '看看这张图，告诉我是什么、能不能删。' : '这些是什么？能不能删？'),
        images.length > 0 ? images.map((i) => ({ dataUrl: i.dataUrl, mimeType: i.mimeType })) : undefined,
        { onChunk, signal },
      );
      patchTurn(turnId, { pending: false });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        patchTurn(turnId, { text: accumulated, pending: false });
      } else {
        patchTurn(turnId, { text: `AI 调用失败：${e instanceof Error ? e.message : String(e)}`, pending: false });
      }
    } finally {
      setBusy(false);
      endChatRequest(signal);
    }
  }, [root, chatNode, pushTurn, patchTurn, setBusy, beginChatRequest, endChatRequest]);

  const recycleNode = useCallback(async (target: Node, reason: string) => {
    // Resolve which (scaffold, scope) — if any — claims this path. The
    // backend's compiled glob is the source of truth for red-line membership,
    // so the frontend cannot skip the scaffold check by guessing.
    let matches;
    try {
      matches = await api.findScopeForPath(target.path);
    } catch (e) {
      pushTurn({ id: uid(), role: 'system', text: `回收失败：${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    // Strict: only proceed when exactly one scope claims the path. Zero
    // matches means the path is outside every scaffold's allowlist (a hard
    // refusal, never a "try anyway" fallback). Multiple matches is
    // ambiguous — disambiguate in Studio rather than picking for the user.
    if (matches.length !== 1) {
      const msg = matches.length === 0
        ? `未找到接管 \`${target.path}\` 的 scaffold；chat 不会绕过红线直接清理。请到 Studio 中用对应卡片清理。`
        : `\`${target.path}\` 命中 ${matches.length} 个 scope，chat 无法在多个候选间自动选择。请到 Studio 中清理。`;
      pushTurn({ id: uid(), role: 'system', text: msg });
      return;
    }
    const m = matches[0]!;
    try {
      await api.execute(m.scaffold_id, m.scope_id, [target.path], reason, false);
      addReclaimed(target.size);
      pushTurn({ id: uid(), role: 'system', text: `已回收 ${target.path} · 释放 ${formatBytes(target.size)}` });
    } catch (e) {
      pushTurn({ id: uid(), role: 'system', text: `回收失败：${e instanceof Error ? e.message : String(e)}` });
    }
  }, [addReclaimed, pushTurn]);

  return { askFollowUp, runStudioPrompt, recycleNode };
}