import { create } from 'zustand';
import type { BootPhase, BootState } from '@shared/schemas';

interface AppState {
  phase: BootPhase;
  vaultPath: string | null;
  busy: boolean;
  init: () => Promise<void>;
  chooseVault: () => Promise<void>;
  refresh: () => Promise<void>;
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
  };
});
