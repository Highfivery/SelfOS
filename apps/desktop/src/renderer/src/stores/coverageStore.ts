import { create } from 'zustand';
import type {
  CandidateCurateInput,
  CoverageSteerInput,
  QuestionnaireCoverageView,
} from '@shared/channels';

/**
 * The Adaptive-Exploration transparency view (spec 70 §3 / spec 69 §3.4) — the active person's OWN forward-first
 * "Explored" read: the candidate feed SelfOS is curious about next, plus an honest area overview + steers.
 * Per-person: reset on the `activePerson.id` change (AppShell). The bridge is the trust boundary (own-scoped,
 * gated `questionnaires.own`); this store is a thin cache + the curate/steer/refresh round-trips, each of which
 * returns the refreshed view so the panel updates without a second fetch.
 */
interface CoverageStoreState {
  view: QuestionnaireCoverageView | null;
  loaded: boolean;
  error: string | null;
  /** The topicId currently mid-steer, so the panel can disable just that row's buttons. */
  steering: string | null;
  /** The candidateId currently mid-curation, so the panel can disable just that card. */
  curating: string | null;
  /** True while the manual "Look for more" candidate refresh is running (it spends). */
  refreshing: boolean;
  /** True while the inline 18+ unlock is being acknowledged. */
  acking: boolean;
  load: () => Promise<void>;
  steer: (input: CoverageSteerInput) => Promise<void>;
  curate: (input: CandidateCurateInput) => Promise<void>;
  lookForMore: () => Promise<void>;
  acknowledgeAdult: () => Promise<void>;
  reset: () => void;
}

const EMPTY = {
  view: null,
  loaded: false,
  error: null,
  steering: null,
  curating: null,
  refreshing: false,
  acking: false,
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
  curate: async (input) => {
    set({ curating: input.candidateId, error: null });
    try {
      const view = (await window.selfos?.questionnairesCurateCandidate(input)) ?? null;
      set({ view, curating: null });
    } catch {
      set({ curating: null, error: 'We couldn’t save that. Try again.' });
    }
  },
  lookForMore: async () => {
    set({ refreshing: true, error: null });
    try {
      const view = (await window.selfos?.questionnairesRefreshNextCandidates()) ?? null;
      // Honest failure (spec 70 §5.4): a degraded pass (no key / over budget / unparseable) leaves the last-good
      // feed — say so rather than silently snapping the button back with an unchanged list.
      set({
        view,
        refreshing: false,
        error: view?.refreshDegraded
          ? 'Couldn’t look for more right now (AI unavailable or over budget). Your list is unchanged.'
          : null,
      });
    } catch {
      set({ refreshing: false, error: 'We couldn’t look for more right now. Try again.' });
    }
  },
  acknowledgeAdult: async () => {
    set({ acking: true, error: null });
    try {
      const view = (await window.selfos?.questionnairesAcknowledgeAdult()) ?? null;
      set({ view, acking: false });
    } catch {
      set({ acking: false, error: 'We couldn’t save that. Try again.' });
    }
  },
  reset: () => set({ ...EMPTY }),
}));
