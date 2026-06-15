import { create } from 'zustand';
import type { Node, Scaffold, AdvisorResponse } from './types';
import { getJson, setJson } from './persist';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  // optional structured advice that goes with the turn
  advice?: AdvisorResponse;
  // optional scaffold suggestion the user can act on inline
  scaffoldId?: string | null;
  pending?: boolean;
}

export interface ToastMsg {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info';
}

interface AppState {
  root: Node | null;
  scaffolds: Scaffold[];
  selectedPath: string | null;
  // Flat chat state — no longer nested under `chat: ChatSession`.
  chatNode: Node | null;
  chatScaffoldId: string | null;
  chatTurns: ChatTurn[];
  chatBusy: boolean;
  chatAbort: AbortController | null;
  studioRequest: { scaffoldId: string; ts: number } | null;
  // Cumulative bytes reclaimed this session. Incremented by ChatPanel's
  // inline recycle and Studio's CleanupModal on success.
  reclaimedBytes: number;
  toasts: ToastMsg[];

  setRoot: (n: Node | null) => void;
  setScaffolds: (s: Scaffold[]) => void;
  selectPath: (p: string | null) => void;
  addReclaimed: (n: number) => void;
  pushToast: (t: Omit<ToastMsg, 'id'>) => void;
  popToast: (id: string) => void;

  focusChatOn: (node: Node, scaffoldId: string | null) => void;
  pushChatTurn: (t: ChatTurn) => void;
  patchChatTurn: (id: string, patch: Partial<ChatTurn>) => void;
  setChatBusy: (b: boolean) => void;
  resetChat: () => void;
  // Aborts any in-flight chat request, returns the new request's signal.
  // Pair with endChatRequest(signal) in the caller's finally — endChatRequest
  // only clears the controller if it's still the one this caller owns, so a
  // stale finally from an aborted request can't wipe out the next one's
  // controller.
  beginChatRequest: () => AbortSignal;
  endChatRequest: (signal: AbortSignal) => void;
  requestStudio: (scaffoldId: string) => void;
  consumeStudio: () => void;
  // Mirrored from useScan's local `scanning` state via useEffect, so
  // Studio can grey itself out while a scan is in flight.
  scanInProgress: boolean;
  setScanInProgress: (b: boolean) => void;
  // Persisted (array, not Set — JSON-friendly). Studio cards whose id is
  // in this set render expanded. Survives app restarts.
  studioExpanded: string[];
  toggleStudioExpanded: (scaffoldId: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  root: null,
  scaffolds: [],
  selectedPath: null,
  chatNode: null,
  chatScaffoldId: null,
  chatTurns: [],
  chatBusy: false,
  chatAbort: null,
  studioRequest: null,
  reclaimedBytes: 0,
  toasts: [],
  scanInProgress: false,
  studioExpanded: getJson<string[]>('studioExpanded', []),

  setRoot: (root) => set({ root }),
  setScaffolds: (scaffolds) => set({ scaffolds }),
  selectPath: (selectedPath) => set({ selectedPath }),
  addReclaimed: (n) => set((s) => ({ reclaimedBytes: s.reclaimedBytes + n })),
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }] })),
  popToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  focusChatOn: (node, scaffoldId) =>
    // Keep prior turns — the user wants ONE running conversation. We just
    // update the "focused" node/scaffold so any inline scaffold chips line
    // up with whatever was most recently dropped.
    set({ chatNode: node, chatScaffoldId: scaffoldId }),
  pushChatTurn: (t) => set((s) => ({ chatTurns: [...s.chatTurns, t] })),
  patchChatTurn: (id, patch) =>
    set((s) => ({
      chatTurns: s.chatTurns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  setChatBusy: (chatBusy) => set({ chatBusy }),
  resetChat: () => {
    get().chatAbort?.abort();
    set({ chatNode: null, chatScaffoldId: null, chatTurns: [], chatBusy: false, chatAbort: null });
  },
  beginChatRequest: () => {
    const prev = get().chatAbort;
    if (prev) prev.abort();
    const ac = new AbortController();
    set({ chatAbort: ac });
    return ac.signal;
  },
  endChatRequest: (signal) => {
    const ac = get().chatAbort;
    if (ac && ac.signal === signal) set({ chatAbort: null });
  },
  requestStudio: (scaffoldId) => set({ studioRequest: { scaffoldId, ts: Date.now() } }),
  consumeStudio: () => set({ studioRequest: null }),
  toggleStudioExpanded: (scaffoldId) => {
    const cur = get().studioExpanded;
    const next = cur.includes(scaffoldId)
      ? cur.filter((x) => x !== scaffoldId)
      : [...cur, scaffoldId];
    setJson('studioExpanded', next);
    set({ studioExpanded: next });
  },
  setScanInProgress: (scanInProgress) => set({ scanInProgress }),
}));