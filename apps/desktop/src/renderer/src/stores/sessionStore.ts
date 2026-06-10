import { create } from 'zustand';
import type { HouseholdStatus, Person } from '@shared/channels';

interface SessionState {
  status: HouseholdStatus | null;
  activePerson: Person | null;
  loaded: boolean;
  /** Fetch household status + the active person. */
  load: () => Promise<void>;
  /** Run first-run setup; resolves to the recovery phrase to show once. */
  setup: (input: { ownerName: string; passphrase: string }) => Promise<string>;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: null,
  activePerson: null,
  loaded: false,
  load: async () => {
    const status = (await window.selfos?.householdStatus()) ?? null;
    const activePerson = (await window.selfos?.getActivePerson()) ?? null;
    set({ status, activePerson, loaded: true });
  },
  setup: async (input) => {
    const result = await window.selfos?.householdSetup(input);
    return result?.recoveryPhrase ?? '';
  },
}));
