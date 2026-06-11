import { create } from 'zustand';
import type { SelfosBridge } from '@shared/channels';
import type { Insight } from '@shared/schemas';

type EditInput = Parameters<SelfosBridge['insightsApprove']>[0];
type DeleteInput = Parameters<SelfosBridge['insightsDelete']>[0];

interface InsightState {
  insights: Insight[];
  loaded: boolean;
  /** Every Insight across all people (the Memory / "what the coach knows" surface, §13.4). */
  load: () => Promise<void>;
  /** Approve a draft (apply edits + chosen shareable facts) so it enters the coach's context. */
  approve: (input: EditInput) => Promise<Insight | null>;
  /** Edit an already-saved Insight. */
  update: (input: EditInput) => Promise<Insight | null>;
  remove: (input: DeleteInput) => Promise<void>;
}

export const useInsightStore = create<InsightState>((set, get) => ({
  insights: [],
  loaded: false,
  load: async () => {
    set({ insights: (await window.selfos?.insightsList()) ?? [], loaded: true });
  },
  approve: async (input) => {
    const result = (await window.selfos?.insightsApprove(input)) ?? null;
    await get().load();
    return result;
  },
  update: async (input) => {
    const result = (await window.selfos?.insightsUpdate(input)) ?? null;
    await get().load();
    return result;
  },
  remove: async (input) => {
    await window.selfos?.insightsDelete(input);
    await get().load();
  },
}));
