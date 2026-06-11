import { create } from 'zustand';
import type { DreamPatternStats, DreamPatternSummary, DreamPatternWindow } from '@shared/schemas';
import { useBudgetStore } from './budgetStore';

/**
 * Cross-dream patterns surface state (12-dreams §3.5): the deterministic stats for the chosen window, the
 * cached AI narrative, and its generate → approve → context lifecycle. Per-person — reset on the
 * active-person change (wired into AppShell), like the other dream stores.
 */
interface DreamPatternState {
  window: DreamPatternWindow;
  stats: DreamPatternStats | null;
  summary: DreamPatternSummary | null;
  loaded: boolean;
  generating: boolean;
  approving: boolean;
  error: string | null;
  /** Load the stats for the current window + the cached narrative. */
  load: () => Promise<void>;
  /** Switch the stats window (re-fetches the deterministic stats only). */
  setWindow: (window: DreamPatternWindow) => Promise<void>;
  /** Generate (and cache) the cross-dream AI narrative — a budget-gated `dream.patterns` call. */
  generate: () => Promise<void>;
  /** Approve the cached narrative into the coach's memory. */
  approve: () => Promise<void>;
  /** Un-approve: remove the narrative's Insight (the cached narrative stays). */
  removeFromContext: () => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  window: '30d' as DreamPatternWindow,
  stats: null,
  summary: null,
  loaded: false,
  generating: false,
  approving: false,
  error: null,
} satisfies Partial<DreamPatternState>;

export const useDreamPatternStore = create<DreamPatternState>((set, get) => ({
  ...EMPTY,
  load: async () => {
    const requested = get().window;
    const [stats, summary] = await Promise.all([
      window.selfos?.dreamPatternStats({ window: requested }) ?? Promise.resolve(null),
      window.selfos?.dreamGetPatternSummary() ?? Promise.resolve(null),
    ]);
    // Guard against a late resolve after the user switched the window mid-load.
    if (get().window !== requested) {
      set({ summary: summary ?? null, loaded: true });
      return;
    }
    set({ stats: stats ?? null, summary: summary ?? null, loaded: true });
  },
  setWindow: async (next) => {
    set({ window: next });
    const stats = await window.selfos?.dreamPatternStats({ window: next });
    // Guard against a late resolve after the user switched again.
    if (get().window === next) set({ stats: stats ?? null });
  },
  generate: async () => {
    if (get().generating) return;
    set({ generating: true, error: null });
    const result = await window.selfos?.dreamPatternNarrative();
    if (result?.ok) {
      set({ summary: result.summary, generating: false });
      await useBudgetStore.getState().refresh(); // dream.patterns is metered → update the usage ring
    } else {
      set({
        generating: false,
        error: result?.message ?? 'The reflection couldn’t be written. Please try again.',
      });
    }
  },
  approve: async () => {
    if (get().approving) return;
    set({ approving: true, error: null });
    const result = await window.selfos?.dreamApprovePatternNarrative();
    if (result?.ok) {
      set((state) => ({
        approving: false,
        summary: state.summary ? { ...state.summary, insightId: result.insightId } : state.summary,
      }));
    } else {
      set({
        approving: false,
        error: result?.message ?? 'Couldn’t add this to your coaching context.',
      });
    }
  },
  removeFromContext: async () => {
    await window.selfos?.dreamRemovePatternNarrative();
    set((state) => {
      if (!state.summary) return {};
      const next = { ...state.summary };
      delete next.insightId;
      return { summary: next };
    });
  },
  reset: () => set({ ...EMPTY }),
}));
