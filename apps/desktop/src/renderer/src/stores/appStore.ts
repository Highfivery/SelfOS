import { create } from 'zustand';
import type { BootPhase, BootState } from '@shared/schemas';
import { useSessionStore } from './sessionStore';
import { useConversationStore } from './conversationStore';
import { useBudgetStore } from './budgetStore';
import { useUsageStore } from './usageStore';
import { useInboxStore } from './inboxStore';
import { useDreamStore } from './dreamStore';
import { useDreamAnalysisStore } from './dreamAnalysisStore';
import { useDreamPatternStore } from './dreamPatternStore';
import { useResultsStore } from './resultsStore';

interface AppState {
  phase: BootPhase;
  vaultPath: string | null;
  busy: boolean;
  init: () => Promise<void>;
  chooseVault: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Unlink the current vault (14-vault-relinking): detach via the bridge, drop all per-vault renderer
   *  state, and route back to onboarding. Rejects (without applying) if the detach fails. */
  unlink: () => Promise<void>;
}

export const useAppStore = create<AppState>((set) => {
  const apply = (boot: BootState | undefined): void => {
    if (boot) set({ phase: boot.phase, vaultPath: boot.vaultPath });
  };

  return {
    phase: 'starting',
    vaultPath: null,
    busy: false,

    init: async () => {
      apply(await window.selfos?.getBootState());
    },

    chooseVault: async () => {
      set({ busy: true });
      try {
        const path = await window.selfos?.selectVaultFolder();
        if (!path) return;
        apply(await window.selfos?.useVault(path));
      } finally {
        set({ busy: false });
      }
    },

    refresh: async () => {
      set({ busy: true });
      try {
        apply(await window.selfos?.refreshBootState());
      } finally {
        set({ busy: false });
      }
    },

    unlink: async () => {
      set({ busy: true });
      try {
        const boot = await window.selfos?.unlinkVault();
        // Drop the previous vault's session + every per-person store so nothing lingers when we
        // re-onboard (the AppShell person-switch reset list, plus resultsStore — same per-person rule).
        useSessionStore.getState().reset();
        useConversationStore.getState().reset();
        useBudgetStore.getState().reset();
        useUsageStore.getState().reset();
        useInboxStore.getState().reset();
        useDreamStore.getState().reset();
        useDreamAnalysisStore.getState().reset();
        useDreamPatternStore.getState().reset();
        useResultsStore.getState().reset();
        apply(boot); // → onboarding; the Shell unmounts and Onboarding's "Choose a folder" takes over
      } finally {
        set({ busy: false });
      }
    },
  };
});
