import { create } from 'zustand';
import type { BudgetState } from '@shared/channels';

interface BudgetStore {
  status: { person: BudgetState; app: BudgetState } | null;
  refresh: () => Promise<void>;
}

/** Active person's budget status, shared by the global usage header and refreshed after each turn. */
export const useBudgetStore = create<BudgetStore>((set) => ({
  status: null,
  refresh: async () => {
    set({ status: (await window.selfos?.budgetStatus()) ?? null });
  },
}));
