import { create } from 'zustand';
import type { SelfosBridge } from '@shared/channels';
import type { Insight, MergeProposal, MemoryReconcileResult } from '@shared/schemas';

type EditInput = Parameters<SelfosBridge['insightsApprove']>[0];
type DeleteInput = Parameters<SelfosBridge['insightsDelete']>[0];
type FlagInput = Parameters<SelfosBridge['insightsFlag']>[0];

interface InsightState {
  insights: Insight[];
  loaded: boolean;
  /** The "kept tidy" signal (39 §3.2): when reconciliation last ran, + queued merge proposals (§3.4). */
  lastReconciledAt: string | undefined;
  proposals: MergeProposal[];
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
  /** Run the AUTOMATIC reconcile cadence (39 §3.3) — a calm no-op unless warranted; reloads if it ran. */
  autoReconcile: () => Promise<void>;
  /** Load the "kept tidy" signal + merge proposals (39 §3.2/§3.4). */
  loadReconcileState: () => Promise<void>;
  /** Confirm (merge) or dismiss (keep both) a queued merge proposal, then reload (§3.4). */
  resolveProposal: (proposalId: string, action: 'merge' | 'keepBoth') => Promise<void>;
  /** Drop the loaded insights — called on an active-person switch so memory never lingers (§5.1). */
  reset: () => void;
}

export const useInsightStore = create<InsightState>((set, get) => ({
  insights: [],
  loaded: false,
  lastReconciledAt: undefined,
  proposals: [],
  load: async () => {
    set({ insights: (await window.selfos?.insightsList()) ?? [], loaded: true });
  },
  loadReconcileState: async () => {
    const state = (await window.selfos?.memoryReconcileState()) ?? { proposals: [] };
    set({ lastReconciledAt: state.lastReconciledAt, proposals: state.proposals });
  },
  reset: () => set({ insights: [], loaded: false, lastReconciledAt: undefined, proposals: [] }),
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
    await get().loadReconcileState();
    return result;
  },
  autoReconcile: async () => {
    const result = await window.selfos?.memoryRefresh({ auto: true });
    // A SKIPPED no-op changed nothing — don't churn the UI. Reload only when a pass actually ran.
    if (result?.ok) {
      await get().load();
    }
    await get().loadReconcileState();
  },
  resolveProposal: async (proposalId, action) => {
    await window.selfos?.memoryResolveProposal({ proposalId, action });
    await get().load();
    await get().loadReconcileState();
  },
}));
