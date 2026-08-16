import { create } from 'zustand';
import type {
  AdaptiveBankView,
  AdaptiveLexiconEdit,
  AdaptivePhaseView,
  AdaptiveProbeView,
  AdaptiveScenarioView,
  AdaptiveStateView,
  EroticLexicon,
} from '@shared/schemas';

/**
 * 74 — the adaptive take's renderer state. Per-person, so it resets on a switch like every other
 * person-scoped store (the `personScopedStores` rule).
 *
 * The take is a small state machine over the phases: `bank` → `split` → `lines` → `probe` → `scenario` →
 * `synthesis`. Each phase persists as it completes, so leaving mid-take resumes rather than losing it.
 */

export type TakePhase = 'intro' | 'bank' | 'split' | 'lines' | 'probe' | 'scenario' | 'done';

export type BankMark = 'love' | 'never' | 'notYet';

interface AdaptiveTestState {
  bank: AdaptiveBankView | null;
  state: AdaptiveStateView | null;
  loaded: boolean;
  busy: boolean;
  /** The live AI phase's label + elapsed seconds — the realtime-progress rule (CLAUDE.md §12). */
  progress: { phase: string; startedAt: number } | null;
  error: string | null;

  phase: TakePhase;
  marks: Record<string, BankMark>;
  splits: Record<string, { hear?: number; say?: number }>;
  lines: string[];
  lineReactions: Record<string, 'love' | 'meh' | 'no'>;
  probeQuestion: string | null;
  /** The ambiguity the current question resolves — stamped as the turn's item id so the engine knows it has
   *  been asked (without it the same ambiguity is returned forever). */
  probeAmbiguityId: string | null;
  probeAnswer: string;
  scenario: { context: string; scene: string; options: string[] } | null;

  load(testId: string): Promise<void>;
  start(testId: string): Promise<void>;
  mark(key: string, mark: BankMark | null): void;
  submitBank(testId: string): Promise<void>;
  setSplit(key: string, direction: 'hear' | 'say', value: number): void;
  submitSplit(testId: string): Promise<void>;
  loadLines(testId: string, round: number): Promise<void>;
  reactToLine(testId: string, line: string, reaction: 'love' | 'meh' | 'no'): Promise<void>;
  nextProbe(testId: string): Promise<void>;
  answerProbe(testId: string): Promise<void>;
  skipProbe(testId: string): Promise<void>;
  loadScenario(testId: string, context: string): Promise<void>;
  answerScenario(testId: string, option: string): Promise<void>;
  synthesize(testId: string): Promise<void>;
  abandon(testId: string): Promise<void>;
  editLexicon(edit: AdaptiveLexiconEdit): Promise<void>;
  setPhase(phase: TakePhase): void;
  reset(): void;
}

const EMPTY = {
  bank: null,
  state: null,
  loaded: false,
  busy: false,
  progress: null,
  error: null,
  phase: 'intro' as TakePhase,
  marks: {},
  splits: {},
  lines: [],
  lineReactions: {},
  probeQuestion: null,
  probeAmbiguityId: null,
  probeAnswer: '',
  scenario: null,
};

export const useAdaptiveTestStore = create<AdaptiveTestState>((set, get) => ({
  ...EMPTY,

  reset: () => set({ ...EMPTY }),
  setPhase: (phase) => set({ phase }),

  load: async (testId) => {
    const [bank, state] = await Promise.all([
      window.selfos?.testsBank({ testId }) ?? Promise.resolve(null),
      window.selfos?.testsAdaptiveState({ testId }) ?? Promise.resolve(null),
    ]);
    // Seed from what they have already said (74 §3.5/§8.2). Without this a retake presents every hard no
    // again, unmarked — the one thing the boundary rule promises will never happen — and "pick up where you
    // left off" drops back to an empty grid.
    const marks: Record<string, BankMark> = {};
    const splits: Record<string, { hear?: number; say?: number }> = {};
    for (const entry of state?.lexicon.entries ?? []) {
      if (entry.state === 'never') marks[entry.key] = 'never';
      else if (entry.state === 'notYet') marks[entry.key] = 'notYet';
      else if (entry.hear > 0 || entry.say > 0) marks[entry.key] = 'love';
      if (entry.hear > 0 || entry.say > 0) splits[entry.key] = { hear: entry.hear, say: entry.say };
    }
    set({ bank, state, loaded: true, marks, splits });
  },

  start: async (testId) => {
    set({ busy: true, error: null });
    const state = await (window.selfos?.testsAdaptiveStart({ testId }) ?? Promise.resolve(null));
    set({ state, busy: false, phase: 'bank' });
  },

  mark: (key, mark) =>
    set((prev) => {
      // A hard no already on record is not re-markable here — it lifts only through the report's explicit
      // "changed my mind" (74 §3.2). The engine refuses it too; this stops the UI implying otherwise.
      const locked = prev.state?.lexicon.entries.some(
        (entry) => entry.key === key && entry.state === 'never',
      );
      if (locked) return prev;
      const marks = { ...prev.marks };
      if (mark === null) delete marks[key];
      else marks[key] = mark;
      return { marks };
    }),

  submitBank: async (testId) => {
    const { state, marks } = get();
    const resultId = state?.draft?.id;
    if (!resultId) return;
    set({ busy: true });
    const next = await (window.selfos?.testsAdaptiveBank({ testId, resultId, marks }) ??
      Promise.resolve(null));
    set({ state: next ?? state, busy: false, phase: 'split' });
  },

  setSplit: (key, direction, value) =>
    set((prev) => ({
      splits: { ...prev.splits, [key]: { ...prev.splits[key], [direction]: value } },
    })),

  submitSplit: async (testId) => {
    const { state, splits } = get();
    const resultId = state?.draft?.id;
    if (!resultId) return;
    set({ busy: true });
    const next = await (window.selfos?.testsAdaptiveSplit({ testId, resultId, splits }) ??
      Promise.resolve(null));
    set({ state: next ?? state, busy: false, phase: 'lines' });
  },

  loadLines: async (testId, round) => {
    const resultId = get().state?.draft?.id;
    if (!resultId) return;
    set({ busy: true, progress: { phase: 'Writing lines for you', startedAt: Date.now() } });
    const fallback: AdaptivePhaseView = { ok: false, degraded: true };
    const out = await (window.selfos?.testsAdaptiveLines({ testId, resultId, round }) ??
      Promise.resolve(fallback));
    set({
      lines: out.lines ?? [],
      busy: false,
      progress: null,
      // A degraded phase is SKIPPED, never fatal — the take moves on with what it has (74 §7).
      ...(out.degraded ? { phase: 'probe' as TakePhase } : {}),
    });
  },

  reactToLine: async (testId, line, reaction) => {
    const resultId = get().state?.draft?.id;
    if (!resultId) return;
    set((prev) => ({ lineReactions: { ...prev.lineReactions, [line]: reaction } }));
    await window.selfos?.testsAdaptiveTurn({
      testId,
      resultId,
      phase: 'lines',
      itemId: line,
      text: line,
      answer: reaction,
    });
  },

  nextProbe: async (testId) => {
    const resultId = get().state?.draft?.id;
    if (!resultId) return;
    set({ busy: true, progress: { phase: 'Thinking about your answers', startedAt: Date.now() } });
    const fallback: AdaptiveProbeView = { ok: false, done: true, degraded: true };
    const out = await (window.selfos?.testsAdaptiveProbe({ testId, resultId }) ??
      Promise.resolve(fallback));
    set({
      probeQuestion: out.question ?? null,
      probeAmbiguityId: out.ambiguityId ?? null,
      probeAnswer: '',
      busy: false,
      progress: null,
      ...(out.done || out.degraded ? { phase: 'scenario' as TakePhase } : {}),
    });
  },

  answerProbe: async (testId) => {
    const { state, probeQuestion, probeAmbiguityId, probeAnswer } = get();
    const resultId = state?.draft?.id;
    if (!resultId || !probeQuestion) return;
    await window.selfos?.testsAdaptiveTurn({
      testId,
      resultId,
      phase: 'probe',
      // The ambiguity id, NOT the model's prose — this is what marks it answered.
      itemId: probeAmbiguityId ?? probeQuestion.slice(0, 60),
      text: probeQuestion,
      answer: probeAnswer,
    });
    await get().nextProbe(testId);
  },

  /** Skipping still RECORDS the ambiguity as asked — otherwise "skip this" hands back the same question. */
  skipProbe: async (testId) => {
    const { state, probeQuestion, probeAmbiguityId } = get();
    const resultId = state?.draft?.id;
    if (resultId && probeQuestion) {
      await window.selfos?.testsAdaptiveTurn({
        testId,
        resultId,
        phase: 'probe',
        itemId: probeAmbiguityId ?? probeQuestion.slice(0, 60),
        text: probeQuestion,
        answer: '',
      });
    }
    await get().nextProbe(testId);
  },

  loadScenario: async (testId, context) => {
    const resultId = get().state?.draft?.id;
    if (!resultId) return;
    set({ busy: true, progress: { phase: 'Setting a scene', startedAt: Date.now() } });
    const fallback: AdaptiveScenarioView = { ok: false, context, degraded: true };
    const out = await (window.selfos?.testsAdaptiveScenario({ testId, resultId, context }) ??
      Promise.resolve(fallback));
    set({
      scenario:
        out.scene && out.options
          ? { context: out.context, scene: out.scene, options: out.options }
          : null,
      busy: false,
      progress: null,
    });
  },

  answerScenario: async (testId, option) => {
    const { state, scenario } = get();
    const resultId = state?.draft?.id;
    if (!resultId || !scenario) return;
    await window.selfos?.testsAdaptiveTurn({
      testId,
      resultId,
      phase: 'scenario',
      itemId: scenario.context,
      text: scenario.scene,
      answer: option,
    });
    set({ scenario: null });
  },

  synthesize: async (testId) => {
    const resultId = get().state?.draft?.id;
    if (!resultId) return;
    set({ busy: true, progress: { phase: 'Writing your profile', startedAt: Date.now() } });
    const next = await (window.selfos?.testsAdaptiveSynthesize({ testId, resultId }) ??
      Promise.resolve(null));
    set({ state: next ?? get().state, busy: false, progress: null, phase: 'done' });
  },

  abandon: async (testId) => {
    const resultId = get().state?.draft?.id;
    if (resultId) await window.selfos?.testsAdaptiveAbandon({ testId, resultId });
    set({ ...EMPTY });
  },

  editLexicon: async (edit) => {
    const lexicon: EroticLexicon | null = await (window.selfos?.testsLexiconEdit(edit) ??
      Promise.resolve(null));
    if (!lexicon) return;
    set((prev) => ({ state: prev.state ? { ...prev.state, lexicon } : prev.state }));
  },
}));
