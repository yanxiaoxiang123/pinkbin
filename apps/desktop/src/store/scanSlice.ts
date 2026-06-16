import type { StateCreator } from 'zustand';
import type { Node, Scaffold } from '../types';

export interface ScanSlice {
  root: Node | null;
  scaffolds: Scaffold[];
  selectedPath: string | null;
  scanInProgress: boolean;
  reclaimedBytes: number;
  setRoot: (n: Node | null) => void;
  setScaffolds: (s: Scaffold[]) => void;
  selectPath: (p: string | null) => void;
  setScanInProgress: (b: boolean) => void;
  addReclaimed: (n: number) => void;
}

export const createScanSlice: StateCreator<ScanSlice, [], [], ScanSlice> = (set) => ({
  root: null,
  scaffolds: [],
  selectedPath: null,
  scanInProgress: false,
  reclaimedBytes: 0,
  setRoot: (root) => set({ root }),
  setScaffolds: (scaffolds) => set({ scaffolds }),
  selectPath: (selectedPath) => set({ selectedPath }),
  setScanInProgress: (scanInProgress) => set({ scanInProgress }),
  addReclaimed: (n) => set((s) => ({ reclaimedBytes: s.reclaimedBytes + n })),
});