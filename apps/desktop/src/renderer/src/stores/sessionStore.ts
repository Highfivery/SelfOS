import { create } from 'zustand';
import type { AccessView, HouseholdStatus, Person, SetActiveResult } from '@shared/channels';
import { roleAllows, type CapabilityKey } from '@shared/capabilities';

interface SessionState {
  status: HouseholdStatus | null;
  activePerson: Person | null;
  access: AccessView | null;
  loaded: boolean;
  /** Fetch household status, the active person, and the access view. */
  load: () => Promise<void>;
  /** Run first-run setup; resolves to the recovery phrase to show once. */
  setup: (input: { ownerName: string; passphrase: string }) => Promise<string>;
  /** Whether the active person's role grants a capability. */
  can: (capability: CapabilityKey) => boolean;
  /** Switch the active person (verifying their PIN); reloads on success. */
  switchTo: (personId: string, pin?: string) => Promise<SetActiveResult>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: null,
  activePerson: null,
  access: null,
  loaded: false,
  load: async () => {
    const status = (await window.selfos?.householdStatus()) ?? null;
    const activePerson = (await window.selfos?.getActivePerson()) ?? null;
    const access = (await window.selfos?.accessGet()) ?? null;
    set({ status, activePerson, access, loaded: true });
  },
  setup: async (input) => {
    const result = await window.selfos?.householdSetup(input);
    return result?.recoveryPhrase ?? '';
  },
  can: (capability) => {
    const { activePerson, access } = get();
    if (!activePerson || !access) return false;
    const account = access.accounts.find((candidate) => candidate.personId === activePerson.id);
    const role = access.roles.find((candidate) => candidate.id === account?.roleId);
    return roleAllows(role, capability);
  },
  switchTo: async (personId, pin) => {
    const result =
      (await window.selfos?.sessionSetActive({ personId, ...(pin ? { pin } : {}) })) ?? null;
    if (result?.ok) await get().load();
    return result ?? { ok: false, reason: 'NO_ACCOUNT' };
  },
}));
