import { create } from 'zustand';
import type { Budget } from '@shared/schemas';
import type { BudgetState, UsagePeriod, UsageSummary } from '@shared/channels';

interface UsageState {
  /** null = everyone (admin) or self (non-admin); otherwise the chosen person's id (admin only). */
  selectedPersonId: string | null;
  period: UsagePeriod;
  summary: UsageSummary | null;
  budget: { app: Budget | null; person: Budget | null } | null;
  status: { person: BudgetState; app: BudgetState } | null;
  people: { id: string; displayName: string }[];
  loaded: boolean;
  load: () => Promise<void>;
  loadPeople: () => Promise<void>;
  setSelectedPerson: (personId: string | null) => Promise<void>;
  setPeriod: (period: UsagePeriod) => Promise<void>;
  saveAppBudget: (budget: Budget | null) => Promise<void>;
  /** Reset to defaults — called when the signed-in person changes (usage + the admin person-filter
   * are per-user; an admin's "view person X" selection must not carry into another account). */
  reset: () => void;
}

const INITIAL = {
  selectedPersonId: null,
  period: 'month' as UsagePeriod,
  summary: null,
  budget: null,
  status: null,
  people: [],
  loaded: false,
} satisfies Partial<UsageState>;

export const useUsageStore = create<UsageState>((set, get) => ({
  ...INITIAL,
  load: async () => {
    const { selectedPersonId, period } = get();
    const input = selectedPersonId
      ? { scope: 'person' as const, period, personId: selectedPersonId }
      : { scope: 'app' as const, period };
    const summary = (await window.selfos?.usageSummary(input)) ?? null;
    const budget = (await window.selfos?.budgetGet()) ?? null;
    const status = (await window.selfos?.budgetStatus()) ?? null;
    set({ summary, budget, status, loaded: true });
  },
  loadPeople: async () => {
    const people = (await window.selfos?.peopleList()) ?? [];
    set({ people: people.map((person) => ({ id: person.id, displayName: person.displayName })) });
  },
  setSelectedPerson: async (selectedPersonId) => {
    set({ selectedPersonId });
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
  reset: () => set({ ...INITIAL }),
}));
