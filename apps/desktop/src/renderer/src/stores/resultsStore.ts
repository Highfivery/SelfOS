import { create } from 'zustand';
import type {
  QuestionnaireAggregate,
  QuestionTrend,
  SelfosBridge,
  SendResult,
} from '@shared/channels';

const EMPTY_AGGREGATE: QuestionnaireAggregate = { questions: [] };

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
  /** Per-question rating-over-time trends across this questionnaire's submitted sends. */
  trends: QuestionTrend[];
  /** The cross-recipient "At a glance" aggregate (§20.7) — distributions/averages/counts; no raw answers. */
  aggregate: QuestionnaireAggregate;
  /** True once the first load for the current questionnaire has resolved — gates the empty state so it
   *  never flashes before data arrives. */
  loaded: boolean;
  loading: boolean;
  load: (questionnaireId: string) => Promise<void>;
  analyze: (assignmentId: string) => Promise<AnalyzeResult>;
  /** Delete one send (its response + any derived Insight), then refresh. */
  remove: (assignmentId: string) => Promise<void>;
  /** Check the relay for new external responses, persist them locally, then refresh. */
  drain: () => Promise<{ drained: number; declined: number }>;
  /** Revoke an external send's relay link, then refresh. */
  revoke: (assignmentId: string) => Promise<void>;
  reset: () => void;
}

export const useResultsStore = create<ResultsState>((set, get) => ({
  questionnaireId: null,
  results: [],
  trends: [],
  aggregate: EMPTY_AGGREGATE,
  loaded: false,
  loading: false,
  load: async (questionnaireId) => {
    set({ questionnaireId, loading: true });
    const [results, trends, aggregate] = await Promise.all([
      window.selfos?.assignmentsResults(questionnaireId) ?? Promise.resolve([]),
      window.selfos?.assignmentsTrends(questionnaireId) ?? Promise.resolve([]),
      window.selfos?.assignmentsAggregate(questionnaireId) ?? Promise.resolve(EMPTY_AGGREGATE),
    ]);
    set({ results, trends, aggregate, loading: false, loaded: true });
  },
  analyze: async (assignmentId) => {
    const result = (await window.selfos?.insightsAnalyze({ assignmentId })) ?? ANALYZE_UNAVAILABLE;
    // Refresh so the analyzed flag flips and the card collapses to the "review in Memory" state.
    const { questionnaireId } = get();
    if (questionnaireId) await get().load(questionnaireId);
    return result;
  },
  remove: async (assignmentId) => {
    await window.selfos?.assignmentsDelete(assignmentId);
    const { questionnaireId } = get();
    if (questionnaireId) await get().load(questionnaireId);
  },
  drain: async () => {
    const result = (await window.selfos?.assignmentsDrain()) ?? { drained: 0, declined: 0 };
    const { questionnaireId } = get();
    if (questionnaireId) await get().load(questionnaireId);
    return result;
  },
  revoke: async (assignmentId) => {
    await window.selfos?.assignmentsRevoke(assignmentId);
    const { questionnaireId } = get();
    if (questionnaireId) await get().load(questionnaireId);
  },
  reset: () =>
    set({
      questionnaireId: null,
      results: [],
      trends: [],
      aggregate: EMPTY_AGGREGATE,
      loaded: false,
      loading: false,
    }),
}));
