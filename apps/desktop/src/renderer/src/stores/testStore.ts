import { create } from 'zustand';
import type { TestResult } from '@shared/schemas';
import type { TestNarrateResponse, TestSummary } from '@selfos/core/tests';

interface TestState {
  catalog: TestSummary[];
  adultAcknowledged: boolean;
  /** The active person's results per test id, newest first (drives profile cards + trends + history). */
  resultsByTest: Record<string, TestResult[]>;
  loaded: boolean;
  load: () => Promise<void>;
  loadResults: (testId: string) => Promise<void>;
  acknowledgeAdult: () => Promise<void>;
  take: (testId: string, answers: Record<string, unknown>) => Promise<TestResult | null>;
  narrate: (testId: string, resultId: string) => Promise<TestNarrateResponse>;
  deleteResult: (testId: string, resultId: string) => Promise<void>;
  deleteAll: (testId: string) => Promise<void>;
  latest: (testId: string) => TestResult | undefined;
  /** Clear when the active person changes — results are per-person; stale state must not leak (04 §8). */
  reset: () => void;
}

/**
 * A load generation. `load()` fans out to 1 + N bridge calls, so a load started for one person can resolve
 * AFTER a `reset()` and a newer load — clobbering the store with the previous person's catalog. That matters
 * more here than in most stores: `adultAcknowledged` rides in the SAME payload, so a stale write could show
 * one person's acknowledged adult instruments to another who has not acknowledged. The bridge still refuses
 * the underlying data, but the withholding is meant to be structural. Bumped by `reset()` and each `load()`.
 */
let loadGeneration = 0;

/** The active person's self-assessments (50 §5.6). Catalog + results flow through the bridge; resets per person. */
export const useTestStore = create<TestState>((set, get) => ({
  catalog: [],
  adultAcknowledged: false,
  resultsByTest: {},
  loaded: false,
  load: async () => {
    const generation = ++loadGeneration;
    const { tests, adultAcknowledged } = (await window.selfos?.testsList()) ?? {
      tests: [],
      adultAcknowledged: false,
    };
    // Load each catalog test's results so the hub can show "Your profiles" without a separate round of calls.
    const resultsByTest: Record<string, TestResult[]> = {};
    await Promise.all(
      tests.map(async (test) => {
        resultsByTest[test.id] = (await window.selfos?.testsResults({ testId: test.id })) ?? [];
      }),
    );
    if (generation !== loadGeneration) return; // a reset or a newer load won — drop this stale write
    set({ catalog: tests, adultAcknowledged, resultsByTest, loaded: true });
  },
  loadResults: async (testId) => {
    const results = (await window.selfos?.testsResults({ testId })) ?? [];
    set((s) => ({ resultsByTest: { ...s.resultsByTest, [testId]: results } }));
  },
  acknowledgeAdult: async () => {
    const { tests, adultAcknowledged } = (await window.selfos?.testsAcknowledgeAdult()) ?? {
      tests: [],
      adultAcknowledged: true,
    };
    set({ catalog: tests, adultAcknowledged });
  },
  take: async (testId, answers) => {
    const result = (await window.selfos?.testsTake({ testId, answers })) ?? null;
    await get().loadResults(testId);
    return result;
  },
  narrate: async (testId, resultId) =>
    (await window.selfos?.testsNarrate({ testId, resultId })) ?? {
      ok: false,
      reason: 'AI_OFF',
      message: 'Not available.',
    },
  deleteResult: async (testId, resultId) => {
    await window.selfos?.testsDeleteResult({ testId, resultId });
    await get().loadResults(testId);
  },
  deleteAll: async (testId) => {
    await window.selfos?.testsDeleteAll({ testId });
    await get().loadResults(testId);
  },
  latest: (testId) => get().resultsByTest[testId]?.[0],
  reset: () => {
    loadGeneration += 1;
    set({ catalog: [], adultAcknowledged: false, resultsByTest: {}, loaded: false });
  },
}));
