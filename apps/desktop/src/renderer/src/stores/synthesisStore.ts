import { create } from 'zustand';
import type { CoachingSynthesis } from '@shared/schemas';
import { useBudgetStore } from './budgetStore';

/**
 * The cross-feature synthesis nudge state (40-proactive-coaching §3.3). Per-person — reset on the
 * `activePerson.id` change (AppShell). `load()` only reads the cached observation (no spend); `run(auto)`
 * runs the AI pass — `auto: true` is the renderer cadence (the bridge applies the throttle/threshold gate),
 * a manual run (no `auto`) forces it ("What are you noticing lately?"). A non-`ok` result is a calm no-op.
 */
interface SynthesisStoreState {
  synthesis: CoachingSynthesis | null;
  loaded: boolean; // the initial no-spend read has completed
  running: boolean; // a synthesis call is in flight
  error: string | null;
  load: () => Promise<void>;
  run: (opts?: { auto?: boolean }) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  synthesis: null,
  loaded: false,
  running: false,
  error: null,
} satisfies Partial<SynthesisStoreState>;

export const useSynthesisStore = create<SynthesisStoreState>((set) => ({
  ...EMPTY,
  load: async () => {
    const synthesis = (await window.selfos?.coachingGetSynthesis()) ?? null;
    set({ synthesis, loaded: true });
  },
  run: async (opts) => {
    set({ running: true, error: null });
    const result = await window.selfos?.coachingSynthesize(opts ?? {});
    if (result?.ok) {
      set({ synthesis: result.synthesis, running: false, error: null });
      await useBudgetStore.getState().refresh(); // a spend — refresh the usage ring
    } else {
      // Auto runs fail silently (a background nicety); a manual run surfaces a calm message.
      set({
        running: false,
        error: opts?.auto ? null : (result?.message ?? 'Nothing to notice right now.'),
      });
    }
  },
  reset: () => set({ ...EMPTY }),
}));
