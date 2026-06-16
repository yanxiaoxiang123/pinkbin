import { create } from 'zustand';
import { createScanSlice, type ScanSlice } from './scanSlice';
import { createChatSlice, type ChatSlice, type ChatTurn } from './chatSlice';
import { createUiSlice, type UiSlice, type ToastMsg } from './uiSlice';
import { loadSettings } from '../advisorClient';

export type { ChatTurn } from './chatSlice';
export type { ToastMsg } from './uiSlice';

export interface AppState extends ScanSlice, ChatSlice, UiSlice {}

export const useStore = create<AppState>()((...args) => ({
  ...createScanSlice(...args),
  ...createChatSlice(...args),
  ...createUiSlice(...args),
  // Initialize advisorReady from persisted settings.
  advisorReady: (() => {
    const s = loadSettings();
    return s !== null && s.model?.trim().length > 0;
  })(),
}));