import { create } from 'zustand';
import type { Transaction, TxFilter } from '@/data/types';

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface QuickAddState {
  open: boolean;
  /** Editing an existing row. */
  editing?: Transaction;
  /** Prefill for a new row (duplicate, recurring, insight action). */
  preset?: Partial<Transaction>;
}

interface UIState {
  quickAdd: QuickAddState;
  toast: Toast | null;
  /** Filter applied from chart taps; Transactions screen reads and clears it. */
  pendingFilter: TxFilter | null;
  /** Monotonic counter so the FAB can bounce on save. */
  savedTick: number;
  /** Income just logged: offer to pay myself first. */
  incomeSplit: Transaction | null;
  setIncomeSplit: (t: Transaction | null) => void;
  openQuickAdd: (s?: Omit<QuickAddState, 'open'>) => void;
  closeQuickAdd: () => void;
  showToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  setPendingFilter: (f: TxFilter | null) => void;
  bumpSaved: () => void;
}

let toastId = 0;

export const useUI = create<UIState>((set) => ({
  quickAdd: { open: false },
  toast: null,
  pendingFilter: null,
  savedTick: 0,
  incomeSplit: null,
  setIncomeSplit: (incomeSplit) => set({ incomeSplit }),
  openQuickAdd: (s = {}) => set({ quickAdd: { open: true, ...s } }),
  closeQuickAdd: () => set({ quickAdd: { open: false } }),
  showToast: (t) => set({ toast: { ...t, id: ++toastId } }),
  dismissToast: () => set({ toast: null }),
  setPendingFilter: (pendingFilter) => set({ pendingFilter }),
  bumpSaved: () => set((s) => ({ savedTick: s.savedTick + 1 })),
}));

export function haptic(ms = 10) {
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(ms);
  } catch {
    /* vibration unsupported */
  }
}
