import type { StateCreator } from 'zustand';
import type { Node, AdvisorResponse } from '../types';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  advice?: AdvisorResponse;
  scaffoldId?: string | null;
  pending?: boolean;
}

export interface ChatSlice {
  chatNode: Node | null;
  chatScaffoldId: string | null;
  chatTurns: ChatTurn[];
  chatBusy: boolean;
  chatAbort: AbortController | null;
  studioRequest: { scaffoldId: string; ts: number } | null;
  advisorReady: boolean;
  focusChatOn: (node: Node, scaffoldId: string | null) => void;
  pushChatTurn: (t: ChatTurn) => void;
  patchChatTurn: (id: string, patch: Partial<ChatTurn>) => void;
  setChatBusy: (b: boolean) => void;
  resetChat: () => void;
  beginChatRequest: () => AbortSignal;
  endChatRequest: (signal: AbortSignal) => void;
  requestStudio: (scaffoldId: string) => void;
  consumeStudio: () => void;
  setAdvisorReady: (b: boolean) => void;
}

export const createChatSlice: StateCreator<ChatSlice, [], [], ChatSlice> = (set, get) => ({
  chatNode: null,
  chatScaffoldId: null,
  chatTurns: [],
  chatBusy: false,
  chatAbort: null,
  studioRequest: null,
  advisorReady: false,
  focusChatOn: (node, scaffoldId) =>
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
  setAdvisorReady: (advisorReady) => set({ advisorReady }),
});