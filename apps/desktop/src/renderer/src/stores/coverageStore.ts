import { create } from 'zustand';
import type { CoverageSteerInput, QuestionnaireCoverageView } from '@shared/channels';

/**
 * The Questionnaire-Intelligence transparency view (spec 69 §3.4) — the active person's OWN "what SelfOS has
 * explored with you" coverage read + steer. Per-person: reset on the `activePerson.id` change (AppShell). The
 * bridge is the trust boundary (own-scoped, gated `questionnaires.own`); this store is a thin cache + the
 * steer round-trip, which returns the refreshed view so the panel updates without a second fetch.
 */
interface CoverageStoreState {
  view: QuestionnaireCoverageView | null;
  loaded: boolean;
  error: string | null;
  /** The topicId currently mid-steer, so the panel can disable just that row's buttons. */
  steering: string | null;
  load: () => Promise<void>;
  steer: (input: CoverageSteerInput) => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  view: null,
  loaded: false,
  error: null,
  steering: null,
} satisfies Partial<CoverageStoreState>;

export const useCoverageStore = create<CoverageStoreState>((set) => ({
  ...EMPTY,
  load: async () => {
    try {
      const view = (await window.selfos?.questionnairesPersonalizationProfile()) ?? null;
      set({ view, loaded: true, error: null });
    } catch {
      set({ loaded: true, error: 'We couldn’t load this right now.' });
    }
  },
  steer: async (input) => {
    set({ steering: input.topicId, error: null });
    try {
      const view = (await window.selfos?.questionnairesSteerTopic(input)) ?? null;
      set({ view, steering: null });
    } catch {
      set({ steering: null, error: 'We couldn’t save that. Try again.' });
    }
  },
  reset: () => set({ ...EMPTY }),
}));
