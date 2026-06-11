import { create } from 'zustand';
import type { SelfosBridge, SendResult } from '@shared/channels';

// Derive the analyze result shape from the bridge contract so the store never drifts from the IPC.
type AnalyzeResult = Awaited<ReturnType<SelfosBridge['insightsAnalyze']>>;

const ANALYZE_UNAVAILABLE: AnalyzeResult = {
  ok: false,
  reason: 'ERROR',
  message: 'Analysis is unavailable.',
};

/**
 * The sender's Results for one questionnaire (08-questionnaires §3.7) — its sends + per-send outcome.
 * Scoped to the active person (the sender) in the bridge; raw answers only ever arrive for Standard,
 * submitted sends. `analyze` turns one submitted response into a draft Insight (reviewed in Memory).
 */
interface ResultsState {
  questionnaireId: string | null;
  results: SendResult[];
  /** True once the first load for the current questionnaire has resolved — gates the empty state so it
   *  never flashes before data arrives. */
  loaded: boolean;
  loading: boolean;
  load: (questionnaireId: string) => Promise<void>;
  analyze: (assignmentId: string) => Promise<AnalyzeResult>;
  reset: () => void;
}

export const useResultsStore = create<ResultsState>((set, get) => ({
  questionnaireId: null,
  results: [],
  loaded: false,
  loading: false,
  load: async (questionnaireId) => {
    set({ questionnaireId, loading: true });
    const results = (await window.selfos?.assignmentsResults(questionnaireId)) ?? [];
    set({ results, loading: false, loaded: true });
  },
  analyze: async (assignmentId) => {
    const result = (await window.selfos?.insightsAnalyze({ assignmentId })) ?? ANALYZE_UNAVAILABLE;
    // Refresh so the analyzed flag flips and the card collapses to the "review in Memory" state.
    const { questionnaireId } = get();
    if (questionnaireId) await get().load(questionnaireId);
    return result;
  },
  reset: () => set({ questionnaireId: null, results: [], loaded: false, loading: false }),
}));
