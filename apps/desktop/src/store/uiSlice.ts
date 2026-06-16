import type { StateCreator } from 'zustand';
import { getJson, setJson } from '../persist';

export interface ToastMsg {
  id: string;
  text: string;
  type: 'success' | 'error' | 'info';
}

const TOAST_CAP = 5;

export interface UiSlice {
  toasts: ToastMsg[];
  studioExpanded: string[];
  pushToast: (t: Omit<ToastMsg, 'id'>) => void;
  popToast: (id: string) => void;
  toggleStudioExpanded: (scaffoldId: string) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set, get) => ({
  toasts: [],
  studioExpanded: getJson<string[]>('studioExpanded', []),
  pushToast: (t) =>
    set((s) => {
      const newToasts = [
        ...s.toasts,
        { ...t, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) },
      ];
      // Cap at TOAST_CAP — pop oldest when exceeded.
      if (newToasts.length > TOAST_CAP) newToasts.shift();
      return { toasts: newToasts };
    }),
  popToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  toggleStudioExpanded: (scaffoldId) => {
    const cur = get().studioExpanded;
    const next = cur.includes(scaffoldId)
      ? cur.filter((x) => x !== scaffoldId)
      : [...cur, scaffoldId];
    setJson('studioExpanded', next);
    set({ studioExpanded: next });
  },
});