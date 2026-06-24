import { create } from 'zustand';
import type { SelfosBridge } from '@shared/channels';
import type { Goal, GoalStatus } from '@shared/schemas';

type UpdateInput = Parameters<SelfosBridge['goalsUpdate']>[0];

interface GoalState {
  goals: Goal[];
  loaded: boolean;
  /** The ACTIVE person's OWN tracked goals (39-living-memory §3.1). The bridge scopes it — this store never
   * holds another member's goals; it resets on a person switch (per-person isolation, 20 §5.1). */
  load: () => Promise<void>;
  setStatus: (goalId: string, status: GoalStatus) => Promise<void>;
  update: (input: UpdateInput) => Promise<Goal | null>;
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
  remove: async (goalId) => {
    await window.selfos?.goalsDelete({ goalId });
    await get().load();
  },
}));
