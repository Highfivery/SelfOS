import { create } from 'zustand';
import type { SelfosBridge } from '@shared/channels';
import type { Insight, MemoryReconcileResult } from '@shared/schemas';

type EditInput = Parameters<SelfosBridge['insightsApprove']>[0];
type DeleteInput = Parameters<SelfosBridge['insightsDelete']>[0];
type FlagInput = Parameters<SelfosBridge['insightsFlag']>[0];

interface InsightState {
  insights: Insight[];
  loaded: boolean;
  /**
   * The ACTIVE person's memory (20-memory-dashboard §5.1): their own insights + their relationships'
   * shareable facts only — the bridge scopes it; this store never holds another member's insights.
   */
  load: () => Promise<void>;
  /** Approve a draft (apply edits + chosen shareable facts) so it enters the coach's context. */
  approve: (input: EditInput) => Promise<Insight | null>;
  /** Edit an already-saved Insight. */
  update: (input: EditInput) => Promise<Insight | null>;
  remove: (input: DeleteInput) => Promise<void>;
  /** Flag/clear a fact (or whole insight) as inaccurate — drops it from the coach at once (§3.6). */
  flag: (input: FlagInput) => Promise<Insight | null>;
  /** Manual "Refresh memory" — a budget-gated AI reconciliation pass; reloads the list after (§3.5). */
  refresh: () => Promise<MemoryReconcileResult>;
  /** Drop the loaded insights — called on an active-person switch so memory never lingers (§5.1). */
  reset: () => void;
}

export const useInsightStore = create<InsightState>((set, get) => ({
  insights: [],
  loaded: false,
  load: async () => {
    set({ insights: (await window.selfos?.insightsList()) ?? [], loaded: true });
  },
  reset: () => set({ insights: [], loaded: false }),
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
  flag: async (input) => {
    const result = (await window.selfos?.insightsFlag(input)) ?? null;
    await get().load();
    return result;
  },
  refresh: async () => {
    const result = (await window.selfos?.memoryRefresh()) ?? {
      ok: false,
      reason: 'ERROR' as const,
      message: 'Memory isn’t available.',
    };
    await get().load();
    return result;
  },
}));
