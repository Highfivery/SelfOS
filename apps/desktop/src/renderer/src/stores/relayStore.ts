import { create } from 'zustand';
import type { RelayStatus } from '@shared/schemas';

interface RelayStore {
  status: RelayStatus | null;
  loaded: boolean;
  load: () => Promise<void>;
  connect: (input: { apiToken: string; accountId: string }) => Promise<void>;
  update: () => Promise<void>;
  teardown: () => Promise<void>;
}

/**
 * The household relay connection status (08-questionnaires §3.8) — household-wide (the relay config lives
 * in the vault), so it is NOT a per-person store and is not reset on a person switch. The admin Relay
 * panel + the external send panel read it; mutations refresh it.
 */
export const useRelayStore = create<RelayStore>((set) => ({
  status: null,
  loaded: false,
  load: async () => {
    set({ status: (await window.selfos?.relayStatus()) ?? null, loaded: true });
  },
  connect: async (input) => {
    set({ status: (await window.selfos?.relayConnect(input)) ?? null, loaded: true });
  },
  update: async () => {
    set({ status: (await window.selfos?.relayUpdate()) ?? null, loaded: true });
  },
  teardown: async () => {
    set({ status: (await window.selfos?.relayTeardown()) ?? null, loaded: true });
  },
}));
