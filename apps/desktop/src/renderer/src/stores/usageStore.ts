import { create } from 'zustand';
import type { Budget } from '@shared/schemas';
import type { BudgetState, UsagePeriod, UsageScope, UsageSummary } from '@shared/channels';

interface UsageState {
  scope: UsageScope;
  period: UsagePeriod;
  summary: UsageSummary | null;
  budget: { app: Budget | null; person: Budget | null } | null;
  status: { person: BudgetState; app: BudgetState } | null;
  loaded: boolean;
  load: () => Promise<void>;
  setScope: (scope: UsageScope) => Promise<void>;
  setPeriod: (period: UsagePeriod) => Promise<void>;
  saveAppBudget: (budget: Budget | null) => Promise<void>;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  scope: 'person',
  period: 'month',
  summary: null,
  budget: null,
  status: null,
  loaded: false,
  load: async () => {
    const { scope, period } = get();
    const summary = (await window.selfos?.usageSummary({ scope, period })) ?? null;
    const budget = (await window.selfos?.budgetGet()) ?? null;
    const status = (await window.selfos?.budgetStatus()) ?? null;
    set({ summary, budget, status, loaded: true });
  },
  setScope: async (scope) => {
    set({ scope });
    await get().load();
  },
  setPeriod: async (period) => {
    set({ period });
    await get().load();
  },
  saveAppBudget: async (budget) => {
    await window.selfos?.budgetSetApp(budget);
    await get().load();
  },
}));
