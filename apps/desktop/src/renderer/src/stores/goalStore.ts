import { create } from 'zustand';
import type { SelfosBridge } from '@shared/channels';
import type { Goal, GoalStatus, GoalSuggestResult } from '@shared/schemas';

type UpdateInput = Parameters<SelfosBridge['goalsUpdate']>[0];
type CreateInput = Parameters<SelfosBridge['goalsCreate']>[0];

interface GoalState {
  goals: Goal[];
  loaded: boolean;
  /** The ACTIVE person's OWN tracked goals (39-living-memory §3.1). The bridge scopes it — this store never
   * holds another member's goals; it resets on a person switch (per-person isolation, 20 §5.1). */
  load: () => Promise<void>;
  setStatus: (goalId: string, status: GoalStatus) => Promise<void>;
  update: (input: UpdateInput) => Promise<Goal | null>;
  /** Create a NEW goal the person set for themselves (or accepted from a suggestion). Reloads on success. */
  create: (input: CreateInput) => Promise<Goal | null>;
  /** Metered "Suggest goals" — proposals only, persists nothing (accept via `create`). */
  suggest: () => Promise<GoalSuggestResult>;
  remove: (goalId: string) => Promise<void>;
  reset: () => void;
}

export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  loaded: false,
  load: async () => {
    set({ goals: (await window.selfos?.goalsList()) ?? [], loaded: true });
  },
  reset: () => set({ goals: [], loaded: false }),
  setStatus: async (goalId, status) => {
    await window.selfos?.goalsSetStatus({ goalId, status });
    await get().load();
  },
  update: async (input) => {
    const result = (await window.selfos?.goalsUpdate(input)) ?? null;
    await get().load();
    return result;
  },
  create: async (input) => {
    const result = (await window.selfos?.goalsCreate(input)) ?? null;
    if (result) await get().load();
    return result;
  },
  suggest: async () =>
    (await window.selfos?.goalsSuggest()) ?? {
      ok: false,
      message: 'Not available.',
    },
  remove: async (goalId) => {
    await window.selfos?.goalsDelete({ goalId });
    await get().load();
  },
}));
