import { create } from 'zustand';
import type { AccessView, HouseholdStatus, Person, SetActiveResult } from '@shared/channels';
import { roleAllows, type CapabilityKey } from '@shared/capabilities';

interface SessionState {
  status: HouseholdStatus | null;
  activePerson: Person | null;
  access: AccessView | null;
  loaded: boolean;
  /** Concealed super-admin "inspect everything" mode (04-people-roles §8). In-memory only. */
  superAdmin: boolean;
  /** Whether the (hidden) super-admin unlock prompt is open. */
  unlockPromptOpen: boolean;
  /** Fetch household status, the active person, and the access view. */
  load: () => Promise<void>;
  /** Run first-run setup; resolves to the recovery phrase to show once. */
  setup: (input: { ownerName: string; passphrase: string }) => Promise<string>;
  /** Whether the active person's role grants a capability (super-admin bypasses all). */
  can: (capability: CapabilityKey) => boolean;
  /** Switch the active person (verifying their PIN); reloads on success. */
  switchTo: (personId: string, pin?: string) => Promise<SetActiveResult>;
  openUnlockPrompt: () => void;
  closeUnlockPrompt: () => void;
  /** Verify the super-admin passphrase; on success, enter inspect-all mode. */
  unlockSuperAdmin: (passphrase: string) => Promise<boolean>;
  lockSuperAdmin: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: null,
  activePerson: null,
  access: null,
  loaded: false,
  superAdmin: false,
  unlockPromptOpen: false,
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
    const { activePerson, access, superAdmin } = get();
    if (superAdmin) return true;
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
  openUnlockPrompt: () => set({ unlockPromptOpen: true }),
  closeUnlockPrompt: () => set({ unlockPromptOpen: false }),
  unlockSuperAdmin: async (passphrase) => {
    const ok = (await window.selfos?.superadminUnlock({ passphrase })) ?? false;
    if (ok) set({ superAdmin: true, unlockPromptOpen: false });
    return ok;
  },
  lockSuperAdmin: () => {
    void window.selfos?.superadminLock();
    set({ superAdmin: false });
  },
}));
