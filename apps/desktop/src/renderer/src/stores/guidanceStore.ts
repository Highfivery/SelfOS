import { create } from 'zustand';
import type { GuidedSuggestion } from '@shared/schemas';
import { useBudgetStore } from './budgetStore';

/**
 * The launcher's "Suggested for you" + 18+ acknowledgement state (16-guided-sessions §3.4/§8.3). Per-person
 * — reset on `activePerson.id` change (AppShell). Suggestions are **explicit-first-tap**: `load()` only
 * reads the cache (no spend); `generate()` spends (`guided.suggest`) and is the first tap + Refresh.
 */
interface GuidanceStoreState {
  suggestions: { generatedAt: string; items: GuidedSuggestion[] } | null;
  adultAcknowledged: boolean;
  loaded: boolean; // the initial no-spend read has completed
  generating: boolean; // a generate/refresh call is in flight
  error: string | null;
  load: () => Promise<void>;
  generate: () => Promise<void>;
  acknowledgeAdult: () => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  suggestions: null,
  adultAcknowledged: false,
  loaded: false,
  generating: false,
  error: null,
} satisfies Partial<GuidanceStoreState>;

export const useGuidanceStore = create<GuidanceStoreState>((set) => ({
  ...EMPTY,
  load: async () => {
    const state = (await window.selfos?.guidedGetState()) ?? {
      cache: null,
      adultAcknowledged: false,
    };
    set({
      suggestions: state.cache
        ? { generatedAt: state.cache.generatedAt, items: state.cache.suggestions }
        : null,
      adultAcknowledged: state.adultAcknowledged,
      loaded: true,
    });
  },
  generate: async () => {
    set({ generating: true, error: null });
    const result = await window.selfos?.guidedSuggest();
    if (result?.ok) {
      set({
        suggestions: { generatedAt: result.generatedAt, items: result.suggestions },
        generating: false,
      });
      await useBudgetStore.getState().refresh(); // a spend — refresh the usage ring
    } else {
      set({ generating: false, error: result?.message ?? 'Couldn’t get suggestions right now.' });
    }
  },
  acknowledgeAdult: async () => {
    const state = await window.selfos?.guidedAcknowledgeAdult();
    if (state) set({ adultAcknowledged: state.adultAcknowledged });
  },
  reset: () => set({ ...EMPTY }),
}));
