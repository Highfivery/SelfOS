import { create } from 'zustand';
import type {
  Challenge,
  ChallengeCheckInResult,
  ChallengeOutcome,
  ChallengeStatus,
  ChallengeSuggestion,
  ChallengeSuggestionResult,
} from '@shared/channels';

interface ChallengeState {
  challenges: Challenge[];
  suggestion: ChallengeSuggestion | null;
  loaded: boolean;
  /** The ACTIVE person's OWN challenges + cached suggestion (52-challenge-sessions §5.5). The bridge scopes it
   * — this store never holds another member's challenges; it resets on a person switch (per-person isolation). */
  load: () => Promise<void>;
  reset: () => void;
  setStatus: (challengeId: string, status: ChallengeStatus) => Promise<void>;
  /** Returns the bridge result so a caller can surface an honest failure (e.g. a stale/missing twin). */
  checkIn: (
    challengeId: string,
    outcome: ChallengeOutcome,
    reflection?: string,
  ) => Promise<ChallengeCheckInResult | null>;
  snooze: (challengeId: string) => Promise<void>;
  seedGoal: (challengeId: string) => Promise<Challenge | null>;
  remove: (challengeId: string) => Promise<void>;
  /** Explicit-tap proactive suggester (§3.7) — spends `challenge.suggest`; caches the candidate. */
  suggest: () => Promise<ChallengeSuggestionResult>;
  /** Dismiss/clear the cached suggestion. */
  clearSuggestion: () => Promise<void>;
}

export const useChallengeStore = create<ChallengeState>((set, get) => ({
  challenges: [],
  suggestion: null,
  loaded: false,
  load: async () => {
    const [challenges, suggestion] = await Promise.all([
      window.selfos?.challengesList() ?? Promise.resolve([]),
      window.selfos?.challengesGetSuggestion() ?? Promise.resolve(null),
    ]);
    set({ challenges: challenges ?? [], suggestion: suggestion ?? null, loaded: true });
  },
  reset: () => set({ challenges: [], suggestion: null, loaded: false }),
  setStatus: async (challengeId, status) => {
    await window.selfos?.challengesSetStatus({ challengeId, status });
    await get().load();
  },
  checkIn: async (challengeId, outcome, reflection) => {
    const result =
      (await window.selfos?.challengesCheckIn({
        challengeId,
        outcome,
        ...(reflection ? { reflection } : {}),
      })) ?? null;
    await get().load();
    return result;
  },
  snooze: async (challengeId) => {
    await window.selfos?.challengesSnooze({ challengeId });
    await get().load();
  },
  seedGoal: async (challengeId) => {
    const result = (await window.selfos?.challengesSeedGoal({ challengeId })) ?? null;
    await get().load();
    return result;
  },
  remove: async (challengeId) => {
    await window.selfos?.challengesDelete({ challengeId });
    await get().load();
  },
  suggest: async () => {
    const result = (await window.selfos?.challengesSuggest()) ?? {
      ok: false as const,
      reason: 'ERROR' as const,
      message: 'Not available.',
    };
    if (result.ok) set({ suggestion: result.suggestion });
    return result;
  },
  clearSuggestion: async () => {
    await window.selfos?.challengesClearSuggestion();
    set({ suggestion: null });
  },
}));
